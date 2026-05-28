<script setup lang="ts">
import { ref, computed, onMounted, watch, h, cloneVNode, type VNode } from 'vue'
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
import type { SelectRenderLabel, SelectRenderOption, SelectRenderTag } from 'naive-ui'
import type { AffectedRun, TrainingRun, Study, StudyAvailability, CreateSampleJobPayload, SampleJob, ValidationResult, WorkflowSummary } from '../api/types'
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
// navigate-to-failed-job: Emitted when the user clicks a red (failed) bead. Payload: job ID of the most recent failed job for that context.
const emit = defineEmits<{
  'update:show': [value: boolean]
  success: []
  'navigate-to-failed-job': [jobId: string]
}>()

const loading = ref(false)
const error = ref<string | null>(null)

// Available options
const trainingRuns = ref<TrainingRun[]>([])
const sampleJobs = ref<SampleJob[]>([])
const studies = ref<Study[]>([])

// Study sample availability for the selected training run
const studyAvailability = ref<StudyAvailability[]>([])
const allRunsAvailability = ref<Map<number, StudyAvailability[]>>(new Map())

// Study editor sub-dialog
const studyEditorOpen = ref(false)

// Training run filter: when true, show all runs; when false, show only gray (empty) runs
const showAllRuns = ref(true)

/** True while a manual refresh of the training runs list is in progress. */
const refreshingTrainingRuns = ref(false)

// Form selections
const selectedTrainingRunId = ref<number | null>(null)
const selectedStudy = ref<string | null>(null)

// S-148: Base model selection for LoRA training runs
const selectedBaseModel = ref<string | null>(null)
const baseModelOptions = ref<string[]>([])
const loadingBaseModels = ref(false)

// S-148: Workflow templates (fetched once, filtered by training run kind)
const workflows = ref<WorkflowSummary[]>([])

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

// When true, applyPrefill has explicitly set checkpoint selections and checkbox defaults.
// The validationResult watcher must not override these choices, even after validation
// returns for the prefilled training run + study combination (S-129).
// Reset to false whenever the user changes the training run or study manually.
const prefillProtected = ref(false)

// When true, smart checkbox defaults have already been applied for the current
// training run + study combination. Reset when the run or study changes so that
// a fresh combo gets fresh defaults. Once set, manual user changes take effect
// without being overridden by subsequent validation re-fetches.
const validationDefaultsApplied = ref(false)

// Persistence composable
const persistence = useGenerateInputsPersistence()

// Current model type (ss_base_model_version) for the selected training run.
// Populated either speculatively from the per-run cache or after a metadata fetch.
const currentModelType = ref<string | null>(null)

// Computed: the selected training run object
const selectedTrainingRun = computed(() =>
  trainingRuns.value.find(r => r.id === selectedTrainingRunId.value) ?? null
)

// S-148: Whether the selected training run is a LoRA run
const isLoraRun = computed(() => selectedTrainingRun.value?.kind === 'lora')

// B-140: Build a workflow lora_capable lookup map from the fetched workflow list.
// Used to determine which studies are compatible with the selected training run kind.
const workflowLoraCapableMap = computed((): Map<string, boolean> => {
  const map = new Map<string, boolean>()
  for (const wf of workflows.value) {
    map.set(wf.name, wf.lora_capable)
  }
  return map
})

/**
 * B-140: Determine whether a study's workflow is compatible with the selected
 * training run kind. LoRA runs require a lora_capable workflow (lora_loader
 * cs_role present). Non-LoRA (checkpoint) runs are compatible with any workflow.
 * Returns true when compatible, false when incompatible.
 */
function isStudyCompatibleWithRunKind(study: Study): boolean {
  if (!isLoraRun.value) return true
  // LoRA run: study's workflow must be lora_capable
  const loraCapable = workflowLoraCapableMap.value.get(study.workflow_template)
  // If workflow not found in map (e.g. deleted workflow), treat as incompatible
  return loraCapable === true
}

// B-140: Whether the currently selected study is incompatible with the selected
// training run kind. Used to disable the launch button with an explanation.
const selectedStudyIncompatible = computed((): boolean => {
  if (!selectedStudy.value || !isLoraRun.value) return false
  const study = studies.value.find(s => s.id === selectedStudy.value)
  if (!study) return false
  return !isStudyCompatibleWithRunKind(study)
})

// S-148: Base model dropdown options
const baseModelSelectOptions = computed(() =>
  baseModelOptions.value.map(m => ({ label: m, value: m })),
)

// Compute status per training run based on job list and sample presence.
// Uses job data as the primary indicator because run.has_samples only checks
// root-level sample directories, not study-scoped ones ({sample_dir}/{study}/{checkpoint}/).
/**
 * AC: Find the most recent failed job for a training run, optionally scoped to a study.
 * Returns the job ID or null if no failed job exists.
 */
function findMostRecentFailedJobId(trainingRunName: string, studyId?: string): string | null {
  const failedJobs = sampleJobs.value
    .filter(j => {
      if (j.training_run_name !== trainingRunName) return false
      if (j.status !== 'failed' && j.status !== 'completed_with_errors') return false
      if (studyId && j.study_id !== studyId) return false
      return true
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return failedJobs.length > 0 ? failedJobs[0].id : null
}

/**
 * AC: Handle click on a red (failed) bead. Emits navigate-to-failed-job with the job ID,
 * which closes the dialog and navigates to the failed job in the Job List.
 */
function handleFailedBeadClick(e: Event, trainingRunName: string, studyId?: string) {
  e.stopPropagation()
  e.preventDefault()
  const jobId = findMostRecentFailedJobId(trainingRunName, studyId)
  if (jobId) {
    emit('navigate-to-failed-job', jobId)
  }
}

/**
 * AC: S-135: Handle click on the "failed" badge next to a checkpoint row.
 * Uses the currently selected training run and study to find the most recent
 * failed job, then emits navigate-to-failed-job to close the dialog and
 * navigate to the job in the Job List.
 */
function handleFailedCheckpointBadgeClick() {
  const runName = selectedTrainingRun.value?.name
  if (!runName) return
  const jobId = findMostRecentFailedJobId(runName, selectedStudy.value ?? undefined)
  if (jobId) {
    emit('navigate-to-failed-job', jobId)
  }
}

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
function renderBeadSpan(color: string, title: string, testId: string, onClick?: (e: Event) => void): VNode {
  return h('span', {
    'data-testid': testId,
    style: {
      display: 'inline-block',
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      flexShrink: '0',
      backgroundColor: color,
      cursor: onClick ? 'pointer' : undefined,
    },
    title,
    onClick: onClick || undefined,
  })
}

/**
 * S-148: Render a kind badge (LoRA) for a training run option.
 * Only shows the badge for LoRA runs since checkpoint is the default/common kind.
 * IMPORTANT: VNodes run outside scoped CSS context — all styles must be inlined.
 */
function renderKindBadge(kind: string | undefined): VNode | null {
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
//   Slot 2 (problem):  red = failed/completed_with_errors job, yellow = incomplete without running jobs
// S-148: Also renders a LoRA kind badge when the training run kind is 'lora'.
const renderTrainingRunLabel: SelectRenderLabel = (option) => {
  const dualBead = (option as { _dualBead?: DualBead })._dualBead
  const kind = (option as { _kind?: string })._kind

  const children: VNode[] = []

  // S-148: Kind badge first
  const badge = renderKindBadge(kind)
  if (badge) children.push(badge)

  if (dualBead) {
    // Slot 1: activity bead (blue/green)
    if (dualBead.activity === 'blue') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.blue, 'running', 'run-bead-activity'))
    } else if (dualBead.activity === 'green') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.green, 'complete', 'run-bead-activity'))
    }

    // Slot 2: problem bead (red/yellow)
    // AC: Clicking red bead navigates to failed job in Job List
    if (dualBead.problem === 'red') {
      const runName = String(option.label ?? '')
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.red, 'failed — click to view job', 'run-bead-problem',
        (e: Event) => handleFailedBeadClick(e, runName)))
    } else if (dualBead.problem === 'yellow') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.yellow, 'incomplete', 'run-bead-problem'))
    }
  }

  children.push(h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
    },
  }, String(option.label ?? '')))

  return h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' } }, children)
}

/**
 * B-098: renderTag for the training-run select closed-state trigger.
 * Controls how the selected value is shown when the dropdown is closed.
 * B-136: Also renders dual-bead status indicators in the closed state so beads
 * are visible regardless of whether the dropdown is open or closed.
 * IMPORTANT: VNodes run outside scoped CSS context — all styles must be inlined.
 *
 * Layout: flexWrap: 'nowrap' keeps beads on the same line as the label text.
 * The label span uses flex: 1 / minWidth: 0 so it fills remaining space and
 * wraps internally rather than pushing beads onto a separate row.
 */
const renderWrappedTrainingRunTag: SelectRenderTag = ({ option }) => {
  const dualBead = (option as { _dualBead?: DualBead })._dualBead
  const kind = (option as { _kind?: string })._kind
  const children: VNode[] = []

  // S-148: Kind badge first
  const badge = renderKindBadge(kind)
  if (badge) children.push(badge)

  if (dualBead) {
    if (dualBead.activity === 'blue') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.blue, 'running', 'run-tag-bead-activity'))
    } else if (dualBead.activity === 'green') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.green, 'complete', 'run-tag-bead-activity'))
    }
    // AC: Clicking red bead navigates to failed job in Job List
    if (dualBead.problem === 'red') {
      const runName = String(option.label ?? '')
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.red, 'failed — click to view job', 'run-tag-bead-problem',
        (e: Event) => handleFailedBeadClick(e, runName)))
    } else if (dualBead.problem === 'yellow') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.yellow, 'incomplete', 'run-tag-bead-problem'))
    }
  }

  children.push(h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
      flex: '1',
      minWidth: '0',
    },
    'data-testid': 'training-run-selected-tag',
  }, String(option.label ?? '')))

  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'nowrap' },
  }, children)
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
      // Use all-runs availability map for bead rendering.
      // For the selected run, prefer the more-current studyAvailability (updated by the watcher).
      const availData = run.id === selectedTrainingRunId.value
        ? studyAvailability.value
        : (allRunsAvailability.value.get(run.id) ?? [])
      // UAT fix (S-116): Refine study statuses for the selected run using validation data.
      // Same logic as the study bead override: if validation shows missing files for the
      // selected study but availability says 'complete', treat it as 'partial'.
      const studyStatuses = availData.map(a => {
        if (
          run.id === selectedTrainingRunId.value &&
          a.study_id === selectedStudy.value &&
          validationResult.value &&
          a.sample_status === 'complete' &&
          validationResult.value.total_missing > 0
        ) {
          return 'partial' as const
        }
        return a.sample_status
      })
      const dualBead = getTrainingRunDualBead(run.name, sampleJobs.value, studyStatuses)

      return {
        label: run.name,
        value: run.id,
        // Custom rendering via renderLabel
        _dualBead: dualBead,
        _kind: run.kind,
      }
    })
})

// Whether the selected run has any existing samples or active jobs (run-level check).
// Used for checkpoint picker visibility, auto-selection, confirmation dialog, and payload construction.
const selectedRunHasSamples = computed(() => {
  const run = selectedTrainingRun.value
  if (!run) return false
  const status = getRunStatus(run)
  return status === 'complete' || status === 'partial' || status === 'running' || status === 'queued'
})

// Whether the selected study (sampleset) has any existing samples or active jobs for the selected training run.
// Scoped to the selected study so the button label accurately reflects whether THIS study has samples,
// not whether the training run has samples for any other study.
// Used ONLY for the button label ('Generate Samples' vs 'Regenerate Samples').
//
// When study availability data has loaded for the selected study, this check is definitive.
// While availability is still loading (studyAvailability is empty), falls back to the run-level
// check to avoid label flicker — the label updates reactively once availability data arrives.
const selectedStudyHasSamples = computed(() => {
  const run = selectedTrainingRun.value
  if (!run) return false
  const studyId = selectedStudy.value
  if (!studyId) return false

  // Check directory-level availability for the selected study (available after async fetch)
  const avail = studyAvailability.value.find(a => a.study_id === studyId)
  if (avail) {
    // Availability data is present — use it definitively
    if (avail.sample_status !== 'none') return true
    // Availability says 'none'; also check for active jobs scoped to this study
    const studyJobs = sampleJobs.value.filter(
      j => j.training_run_name === run.name && j.study_id === studyId,
    )
    return studyJobs.some(j => j.status === 'running' || j.status === 'pending' || j.status === 'stopped')
  }

  // Study not found in availability data. Two cases:
  // 1. studyAvailability is empty: data has not loaded yet — fall back to run-level to avoid
  //    label flicker while the async fetch is in-flight. The computed re-evaluates reactively
  //    once the fetch resolves.
  // 2. studyAvailability has entries but not for this study: data has loaded and this study
  //    simply has no samples (e.g. it was just created). Check active jobs only.
  if (studyAvailability.value.length === 0) {
    // Data still loading — use run-level as a transient placeholder
    return getRunStatus(run) === 'complete' || getRunStatus(run) === 'partial' ||
      getRunStatus(run) === 'running' || getRunStatus(run) === 'queued'
  }

  // Data loaded but study not in results — newly created study with no samples. Check jobs only.
  const studyJobs = sampleJobs.value.filter(
    j => j.training_run_name === run.name && j.study_id === studyId,
  )
  return studyJobs.some(j => j.status === 'running' || j.status === 'pending' || j.status === 'stopped')
})

// Checkpoints of the selected training run
const selectedRunCheckpoints = computed(() => selectedTrainingRun.value?.checkpoints ?? [])

// Map of checkpoint filename -> error message for checkpoints that failed in the most
// recent completed_with_errors job for the selected training run.
const failedCheckpointMap = computed((): Map<string, string> => {
  const run = selectedTrainingRun.value
  if (!run) return new Map()

  // Find the most recent completed_with_errors job for this run, scoped to the selected study.
  // Must match the same study filter used by handleFailedCheckpointBadgeClick / findMostRecentFailedJobId
  // to avoid showing badges for jobs belonging to a different study.
  const errorJobs = sampleJobs.value
    .filter(j =>
      j.training_run_name === run.name &&
      j.status === 'completed_with_errors' &&
      (!selectedStudy.value || j.study_id === selectedStudy.value),
    )
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
watch(selectedTrainingRunId, async (runId) => {
  const skipAutoSelection = prefillActive.value
  prefillActive.value = false

  // Reset model type for the new run
  currentModelType.value = null

  // S-148: Reset base model selection and fetch base models for LoRA runs
  if (!skipAutoSelection) {
    selectedBaseModel.value = null
  }
  const selectedRun = trainingRuns.value.find(r => r.id === runId)
  if (selectedRun?.kind === 'lora') {
    fetchBaseModels()
  }

  // When prefill is active, skip all automatic state changes — the caller
  // (applyPrefill) has already set checkpoints, clearExisting, and form values.
  if (!skipAutoSelection) {
    selectedCheckpoints.value = new Set()
    clearExisting.value = false
    missingOnly.value = false
  }
  validationResult.value = null
  // S-129: When prefill is active, mark defaults as already applied so the validationResult
  // watcher does not override checkpoints/checkboxes set by applyPrefill.
  // When not in prefill mode, reset so fresh smart defaults are applied once validation returns.
  validationDefaultsApplied.value = skipAutoSelection

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

    if (runId !== null) {
      // S-119: Speculatively apply per-model-type workflow if the model type is already
      // cached from a previous session. This avoids waiting for the async metadata fetch.
      const cachedModelType = persistence.getModelTypeForRun(runId)
      if (cachedModelType !== null) {
        currentModelType.value = cachedModelType
        applyPerModelTypeWorkflow(cachedModelType)
      }

      // Fetch checkpoint metadata to confirm or populate the model type cache.
      // Always runs regardless of cache hit to keep the cache fresh.
      const firstCheckpoint = run.checkpoints[0]
      try {
        const metadataResult = await apiClient.getCheckpointMetadata(firstCheckpoint.filename)
        const modelType = metadataResult.metadata['ss_base_model_version'] ?? null
        if (modelType) {
          persistence.saveModelTypeForRun(runId, modelType)
          // AC2: Apply per-model-type workflow when model type was not previously cached
          if (currentModelType.value === null) {
            currentModelType.value = modelType
            applyPerModelTypeWorkflow(modelType)
          } else {
            // Update currentModelType in case it differed from cache (e.g. run was replaced)
            currentModelType.value = modelType
          }
        }
      } catch {
        // Metadata fetch failure is non-fatal; proceed with cached model type (if any)
      }
    }
  }
})

// Fetch study sample availability when training run changes
watch(selectedTrainingRunId, async (runId) => {
  studyAvailability.value = []
  if (runId === null) return

  try {
    const avail = await apiClient.getStudyAvailability(runId)
    studyAvailability.value = avail
    // Keep allRunsAvailability in sync for consistent bead rendering
    allRunsAvailability.value = new Map(allRunsAvailability.value).set(runId, avail)
  } catch {
    // Non-fatal; proceed without availability data
    studyAvailability.value = []
  }
})

// Trigger validation when training run + study are both selected
watch([selectedTrainingRunId, selectedStudy], async () => {
  validationResult.value = null
  // S-129: If prefill just set checkpoints/checkboxes, mark defaults as applied so
  // the validationResult watcher does not override applyPrefill's explicit choices.
  // If not in prefill mode, reset so smart defaults are applied once validation returns.
  validationDefaultsApplied.value = prefillProtected.value
  // Consume the prefill protection flag so subsequent user-triggered changes reset defaults
  prefillProtected.value = false
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

// S-115 / S-129: Apply smart defaults when validation results arrive.
// - Incomplete sample set (some missing): check "Generate missing only", uncheck "Clear existing"
// - Complete sample set (none missing): leave "Clear existing" unchecked (default)
// - S-129: Pre-select only incomplete checkpoints (missing > 0); deselect complete checkpoints.
//
// Defaults are applied only once per training run + study combination
// (guarded by validationDefaultsApplied). After the first application,
// manual user changes to checkboxes and checkpoint selections are respected and not overridden.
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

  // S-129: Apply default checkpoint selection based on completion status.
  // Only applies when the checkpoint picker is shown (run has existing samples).
  // A checkpoint is "complete" when it has verified samples and none are missing (verified > 0 AND missing <= 0).
  // Complete checkpoints are unchecked by default; incomplete or unstarted checkpoints are pre-selected.
  // This avoids re-generating samples that already exist while still targeting gaps.
  if (selectedRunHasSamples.value && result.checkpoints.length > 0) {
    const incompleteOrUnstartedFilenames = result.checkpoints
      .filter(c => !(c.verified > 0 && c.missing <= 0))
      .map(c => c.checkpoint)
    selectedCheckpoints.value = new Set(incompleteOrUnstartedFilenames)
  }

  validationDefaultsApplied.value = true
})

// Persist training run selection changes (AC3)
watch(selectedTrainingRunId, (runId) => {
  if (runId !== null) {
    persistence.saveTrainingRunId(runId)
  }
})

// Persist study selection changes.
// B-107: Only persist non-null values so that resetForm() (which sets null)
// does not erase the persisted study. This allows the show watcher to restore
// the last selected study when the dialog is reopened after close().
watch(selectedStudy, (studyId) => {
  if (studyId !== null) {
    persistence.saveStudyId(studyId)
  }

  // S-119: When a study is selected and the model type is known, persist the study's
  // workflow template as the per-model-type workflow preference. This allows the correct
  // study to be auto-selected on the next session when the model type is cached.
  if (studyId !== null && currentModelType.value !== null) {
    const study = studies.value.find(s => s.id === studyId)
    if (study?.workflow_template) {
      persistence.saveWorkflowIdForModelType(currentModelType.value, study.workflow_template)
    }
  }
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

/**
 * S-119: Apply the per-model-type workflow preference by auto-selecting the study
 * whose workflow_template matches the stored preference for the given model type.
 * Only applies when a matching study exists and no study is already selected.
 */
function applyPerModelTypeWorkflow(modelType: string) {
  // Do not override an explicitly selected study
  if (selectedStudy.value !== null) return

  const preferredWorkflowId = persistence.getWorkflowIdForModelType(modelType)
  if (!preferredWorkflowId) return

  // Find a study whose workflow_template matches the preferred workflow
  const matchingStudy = studies.value.find(s => s.workflow_template === preferredWorkflowId)
  if (matchingStudy) {
    selectedStudy.value = matchingStudy.id
  }
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
// NOTE: Bead status uses studyAvailability data (directory-level) as the baseline,
// with validation-level refinement for the selected study. When the selected study's
// availability says 'complete' but validation reveals missing files, the bead status
// is refined to 'partial' (S-116 UAT fix). Non-selected studies use availability only.
const studyOptions = computed(() => {
  const runName = selectedTrainingRun.value?.name ?? ''

  return studies.value.map(p => {
    const avail = studyAvailability.value.find(a => a.study_id === p.id)
    let sampleStatus = avail?.sample_status ?? 'none'

    // UAT fix (S-116): Refine bead status for the selected study using validation
    // results. The availability API only checks whether checkpoint directories exist,
    // not whether all expected files are present. When validation shows missing files
    // (total_missing > 0) but availability reports 'complete' (all dirs exist), override
    // to 'partial' so the bead correctly shows yellow instead of green.
    if (
      p.id === selectedStudy.value &&
      validationResult.value &&
      sampleStatus === 'complete' &&
      validationResult.value.total_missing > 0
    ) {
      sampleStatus = 'partial'
    }

    // Compute dual-bead for this study. Only possible when a training run is selected.
    const dualBead = runName
      ? getStudyDualBead(runName, p.id, sampleJobs.value, sampleStatus)
      : { activity: null, problem: null }

    // Checkpoint counts for tooltip
    const checkpointCounts = avail
      ? { withSamples: avail.checkpoints_with_samples, total: avail.total_checkpoints }
      : null

    // B-140: Check if this study's workflow is compatible with the selected run kind
    const compatible = isStudyCompatibleWithRunKind(p)

    return {
      label: p.name,
      value: p.id,
      // Metadata for bead rendering
      _sampleStatus: sampleStatus,
      _dualBead: dualBead,
      _checkpointCounts: checkpointCounts,
      // B-140: Compatibility metadata
      _compatible: compatible,
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
  const compatible = (option as { _compatible?: boolean })._compatible

  // Build a human-readable checkpoint count tooltip, e.g. "3/5 checkpoints have samples"
  const checkpointCountTitle = counts
    ? `${counts.withSamples}/${counts.total} checkpoints have samples`
    : null

  const children: VNode[] = []

  // B-140: Show incompatibility warning badge for studies whose workflow
  // is not compatible with the selected training run kind (e.g. LoRA run + non-LoRA workflow)
  if (compatible === false) {
    children.push(h('span', {
      'data-testid': 'study-incompatible-badge',
      style: {
        display: 'inline-block',
        padding: '0 6px',
        fontSize: '11px',
        lineHeight: '18px',
        borderRadius: '3px',
        backgroundColor: 'rgba(255, 152, 0, 0.15)',
        color: '#e68a00',
        fontWeight: '600',
        flexShrink: '0',
        whiteSpace: 'nowrap',
      },
      title: 'This study uses a workflow that is not compatible with LoRA training runs',
    }, 'Not LoRA'))
  }

  if (dualBead) {
    // Slot 1: activity bead (blue/green)
    if (dualBead.activity === 'blue') {
      // Running: show checkpoint counts if available, e.g. "running — 3/5 checkpoints have samples"
      const blueTitle = checkpointCountTitle ? `running — ${checkpointCountTitle}` : 'running'
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.blue, blueTitle, 'study-bead-activity'))
    } else if (dualBead.activity === 'green') {
      // Complete: show checkpoint counts in title (e.g. "5/5 checkpoints have samples")
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.green, checkpointCountTitle ?? 'complete', 'study-bead-activity'))
    }

    // Slot 2: problem bead (red/yellow)
    // AC: Clicking red bead navigates to failed job in Job List
    if (dualBead.problem === 'red') {
      // Failed: show checkpoint counts if available, e.g. "failed — 3/5 checkpoints have samples"
      const redTitle = checkpointCountTitle ? `failed — ${checkpointCountTitle} — click to view job` : 'failed — click to view job'
      const runName = selectedTrainingRun.value?.name ?? ''
      const studyId = String(option.value ?? '')
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.red, redTitle, 'study-bead-problem',
        (e: Event) => handleFailedBeadClick(e, runName, studyId)))
    } else if (dualBead.problem === 'yellow') {
      // Partial: show checkpoint counts in title (e.g. "3/5 checkpoints have samples")
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.yellow, checkpointCountTitle ?? 'incomplete', 'study-bead-problem'))
    }
  }

  children.push(h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
      // B-140: Grey out incompatible study labels
      ...(compatible === false ? { opacity: '0.5' } : {}),
    },
  }, String(option.label ?? '')))

  return h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' } }, children)
}

/**
 * B-098: renderTag for the study select closed-state trigger.
 * B-136: Also renders dual-bead status indicators in the closed state so beads
 * are visible regardless of whether the dropdown is open or closed.
 * IMPORTANT: VNodes run outside scoped CSS context — all styles must be inlined.
 *
 * Layout: flexWrap: 'nowrap' keeps beads on the same line as the label text.
 * The label span uses flex: 1 / minWidth: 0 so it fills remaining space and
 * wraps internally rather than pushing beads onto a separate row.
 */
const renderWrappedStudyTag: SelectRenderTag = ({ option }) => {
  const dualBead = (option as { _dualBead?: DualBead })._dualBead
  const children: VNode[] = []

  if (dualBead) {
    if (dualBead.activity === 'blue') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.blue, 'running', 'study-tag-bead-activity'))
    } else if (dualBead.activity === 'green') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.green, 'complete', 'study-tag-bead-activity'))
    }
    // AC: Clicking red bead navigates to failed job in Job List
    if (dualBead.problem === 'red') {
      const runName = selectedTrainingRun.value?.name ?? ''
      const studyId = String(option.value ?? '')
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.red, 'failed — click to view job', 'study-tag-bead-problem',
        (e: Event) => handleFailedBeadClick(e, runName, studyId)))
    } else if (dualBead.problem === 'yellow') {
      children.push(renderBeadSpan(DUAL_BEAD_COLORS.yellow, 'incomplete', 'study-tag-bead-problem'))
    }
  }

  children.push(h('span', {
    style: {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: '1.4',
      flex: '1',
      minWidth: '0',
    },
    'data-testid': 'study-selected-tag',
  }, String(option.label ?? '')))

  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'nowrap' },
  }, children)
}

/**
 * S-133: zebra-stripe renderOption for the training-run dropdown.
 * Naive UI renders the dropdown menu via Teleport (outside the component's DOM subtree)
 * so scoped :deep() CSS cannot reach option elements. We use renderOption to clone each
 * VNode and inject an alternating background style so every other row is lightly tinted.
 * IMPORTANT: VNodes run outside Vue's scoped CSS context — all styles must be inlined.
 */
const renderZebraTrainingRunOption: SelectRenderOption = ({ node, option }) => {
  const index = trainingRunOptions.value.findIndex((o) => o.value === option.value)
  if (index < 0 || index % 2 === 0) return node
  // Use a literal rgba value — CSS variables do not resolve in inline styles injected
  // via renderOption (VNodes rendered outside scoped CSS context via Teleport).
  return cloneVNode(node, { style: { backgroundColor: 'rgba(128, 128, 128, 0.07)' } })
}

/**
 * S-133: zebra-stripe renderOption for the study dropdown.
 * Declared after studyOptions so the closure resolves correctly.
 */
const renderZebraStudyOption: SelectRenderOption = ({ node, option }) => {
  const index = studyOptions.value.findIndex((o) => o.value === option.value)
  if (index < 0 || index % 2 === 0) return node
  return cloneVNode(node, { style: { backgroundColor: 'rgba(128, 128, 128, 0.07)' } })
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
  if (selectedCheckpoints.value.size === 0) return 'Select at least one checkpoint to generate'
  return null
})

const canSubmit = computed(() => {
  if (selectedTrainingRunId.value === null) return false
  if (selectedStudy.value === null) return false
  if (checkpointValidationError.value !== null) return false
  // S-148: LoRA runs require a base model selection
  if (isLoraRun.value && !selectedBaseModel.value) return false
  // B-140: Block launch when study workflow is incompatible with training run kind
  if (selectedStudyIncompatible.value) return false
  return true
})

// AC4: When refreshTrigger changes (job status changed via WebSocket), refresh training run + job data
// and re-fetch study availability for the selected run so bead states update in real-time
// without requiring a page refresh (UAT feedback: S-116).
watch(() => props.refreshTrigger, async () => {
  await fetchTrainingRunsAndJobs()
  // Re-fetch study availability for the selected run to update bead states.
  // fetchAllRunsAvailability (called by fetchTrainingRunsAndJobs) updates allRunsAvailability
  // but studyAvailability (used for the selected run's beads) must be refreshed separately.
  if (selectedTrainingRunId.value !== null) {
    try {
      const avail = await apiClient.getStudyAvailability(selectedTrainingRunId.value)
      studyAvailability.value = avail
      // Keep allRunsAvailability in sync for consistent bead rendering
      allRunsAvailability.value = new Map(allRunsAvailability.value).set(selectedTrainingRunId.value, avail)
    } catch {
      // Non-fatal; proceed with stale availability data
    }
  }
})

// When the dialog opens, re-fetch data and restore state.
// B-107: Handle BOTH prefillJob and non-prefillJob reopening to prevent state
// loss after close() resets the form (e.g. after a successful study regeneration
// which calls close() and resetForm(), leaving the dialog blank on next open).
watch(() => props.show, async (newShow) => {
  if (!newShow) return

  // Re-fetch data to ensure latest state
  await Promise.all([
    fetchTrainingRunsAndJobs(),
    fetchStudies(),
  ])

  if (props.prefillJob) {
    applyPrefill(props.prefillJob)
    return
  }

  // B-107: Restore persisted selections when reopening without prefill.
  // Only restore if the form is in a reset state (both selectors empty),
  // to avoid overriding user selections on the initial mount open.
  if (selectedTrainingRunId.value !== null || selectedStudy.value !== null) return

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

  const lastTrainingRunId = persistence.getLastTrainingRunId()
  if (lastTrainingRunId !== null) {
    const runExists = trainingRuns.value.some(r => r.id === lastTrainingRunId)
    if (runExists) {
      selectedTrainingRunId.value = lastTrainingRunId
    }
  }
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
    const [runs, jobs, wfs] = await Promise.all([
      apiClient.getCheckpointTrainingRuns(),
      apiClient.listSampleJobs(),
      apiClient.listWorkflows(),
    ])
    trainingRuns.value = runs
    sampleJobs.value = jobs
    workflows.value = wfs

    // Fetch availability for all runs in parallel for training run bead rendering
    await fetchAllRunsAvailability(runs)
  } catch {
    trainingRuns.value = []
    sampleJobs.value = []
    workflows.value = []
  }
}

/** B-143: Fetch available base models from base_model_dir (no ComfyUI dependency). */
async function fetchBaseModels() {
  loadingBaseModels.value = true
  try {
    const result = await apiClient.getBaseModels()
    baseModelOptions.value = result.models
  } catch {
    baseModelOptions.value = []
  } finally {
    loadingBaseModels.value = false
  }
}

/** Fetch availability for all training runs in parallel; awaited by fetchTrainingRunsAndJobs. */
async function fetchAllRunsAvailability(runs: TrainingRun[]) {
  const entries = await Promise.all(
    runs.map(async (run): Promise<[number, StudyAvailability[]]> => {
      try {
        const avail = await apiClient.getStudyAvailability(run.id)
        return [run.id, avail]
      } catch {
        return [run.id, []]
      }
    }),
  )
  allRunsAvailability.value = new Map(entries)
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
  prefillProtected.value = false
  validationResult.value = null
  validationDefaultsApplied.value = false
  validating.value = false
  studyAvailability.value = []
  error.value = null
  confirmRegenOpen.value = false
  currentModelType.value = null
  // S-148: Reset LoRA-specific state
  selectedBaseModel.value = null
  baseModelOptions.value = []
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

  // Set prefillProtected so the validation result watcher does not override the
  // checkpoint selections and checkbox defaults that applyPrefill is about to set (S-129).
  prefillProtected.value = true

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

  // S-148: Restore base model from the prefilled job for LoRA runs
  if (run.kind === 'lora' && job.base_model) {
    selectedBaseModel.value = job.base_model
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
  // AC2: Close the study editor sub-modal immediately on save, before the fetch,
  // so the dialog disappears without delay even under parallel-shard load (B-130).
  studyEditorOpen.value = false
  await fetchStudies()
  selectedStudy.value = study.id
}

/**
 * B-115: Handle in-place study regeneration. The StudyEditor now provides
 * the list of affected training runs (those with existing samples for this study).
 * Creates a regeneration job with clear_existing=true for each affected run.
 * If no affected runs are provided, falls back to the currently selected training run.
 */
async function onStudyRegenerate(study: Study, affectedRuns: AffectedRun[]) {
  await fetchStudies()
  selectedStudy.value = study.id
  studyEditorOpen.value = false

  // Determine which training run names need regeneration jobs
  const runNames = affectedRuns.length > 0
    ? affectedRuns.map(r => r.training_run_name)
    : selectedTrainingRun.value ? [selectedTrainingRun.value.name] : []

  if (runNames.length === 0) {
    // B-115: Even when no affected runs are found, close the dialog so the
    // user isn't stranded in the Generate Samples view after confirming.
    close()
    return
  }

  loading.value = true
  error.value = null
  try {
    // Create a regeneration job for each affected training run
    for (const runName of runNames) {
      const payload: CreateSampleJobPayload = {
        training_run_name: runName,
        study_id: study.id,
        clear_existing: true,
      }
      await apiClient.createSampleJob(payload)
    }
    // B-115: Close dialog and switch to job list after successful job creation.
    // emit('success') triggers onJobCreated() in App.vue which opens the job panel.
    emit('success')
    close()
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to create regeneration job'
    error.value = message
  } finally {
    loading.value = false
  }
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

    // S-148: Include base_model for LoRA jobs
    if (isLoraRun.value && selectedBaseModel.value) {
      payload.base_model = selectedBaseModel.value
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
        @study-regenerate="onStudyRegenerate"
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
            :render-tag="renderWrappedTrainingRunTag"
            :render-option="renderZebraTrainingRunOption"
            :consistent-menu-width="false"
            :menu-props="{ style: 'min-width: 320px; max-width: min(1024px, 100vw)' }"
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
            :render-tag="renderWrappedStudyTag"
            :render-option="renderZebraStudyOption"
            :consistent-menu-width="false"
            :menu-props="{ style: 'min-width: 200px; max-width: min(1024px, 100vw)' }"
            placeholder="Select a study"
            clearable
            filterable
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

      <!-- B-140: Incompatible workflow warning — shown when a LoRA run is selected
           with a study whose workflow lacks a lora_loader node -->
      <NAlert
        v-if="selectedStudyIncompatible"
        type="warning"
        data-testid="study-incompatible-warning"
      >
        The selected study uses a workflow that is not LoRA-capable. Choose a study with a LoRA workflow, or edit this study to use a LoRA-capable workflow template.
      </NAlert>

      <!-- S-148: Base model selector — shown only for LoRA training runs -->
      <div v-if="isLoraRun" class="form-field" data-testid="base-model-field">
        <label for="base-model-select">Base Model</label>
        <NSelect
          id="base-model-select"
          v-model:value="selectedBaseModel"
          :options="baseModelSelectOptions"
          :loading="loadingBaseModels"
          :disabled="loadingBaseModels"
          :consistent-menu-width="false"
          :menu-props="{ style: 'min-width: 320px; max-width: min(1024px, 100vw)' }"
          placeholder="Select a base model (UNET)"
          clearable
          filterable
          data-testid="base-model-select"
        />
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
          <span
            v-if="validationResult.total_missing > 0"
            class="validation-totals-alert-icon"
            data-testid="validation-totals-alert-icon"
            title="Missing samples detected"
          >&#x26A0;</span>
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
                    class="failed-checkpoint-tag failed-checkpoint-tag--clickable"
                    :data-testid="`checkpoint-failed-badge-${cp.checkpoint}`"
                    @click.stop.prevent="handleFailedCheckpointBadgeClick"
                  >
                    failed
                  </NTag>
                </template>
                {{ failedCheckpointMap.get(cp.checkpoint) }} — click to view job
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
        <p><strong>Training Run:</strong> {{ selectedTrainingRun?.name ?? 'N/A' }}{{ isLoraRun ? ' (LoRA)' : '' }}</p>
        <p v-if="isLoraRun"><strong>Base Model:</strong> {{ selectedBaseModel ?? 'N/A' }}</p>
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
          {{ loading ? 'Creating...' : (selectedStudyHasSamples ? 'Regenerate Samples' : 'Generate Samples') }}
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
  margin-left: 0.5rem;
}

.failed-checkpoint-tag {
  margin-left: 0.5rem;
}

.failed-checkpoint-tag--clickable {
  cursor: pointer;
}

.validation-totals {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.validation-totals-alert-icon {
  color: var(--warning-color);
  font-size: 1rem;
  flex-shrink: 0;
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

/*
 * B-098: Override Naive UI NSelect trigger internals so the closed-state selector
 * grows vertically when the selected name is long.
 *
 * This mirrors the same override applied in TrainingRunSelector.vue and is
 * required here because JobLaunchDialog has its own scoped CSS scope.
 *
 * For filterable single-select, Naive UI renders:
 *   .n-base-selection-label (inline-flex, height: var(--n-height))
 *     <input class="n-base-selection-input" />   ← width: 100% in flex
 *     .n-base-selection-label__render-label      ← position: absolute overlay
 *       .n-base-selection-overlay__wrapper
 *         [renderTag output]
 *
 * Solution:
 *   1. Label: height: auto so it can grow vertically.
 *   2. Input: width: 0 / flex: 0 so it takes no space when collapsed.
 *   3. Overlay: position: relative so it participates in flex layout.
 *   4. Overlay wrapper: allow text to wrap naturally.
 */
.training-run-select-input :deep(.n-base-selection),
.study-select :deep(.n-base-selection) {
  height: auto !important;
  min-height: var(--n-height);
}

.training-run-select-input :deep(.n-base-selection-label),
.study-select :deep(.n-base-selection-label) {
  height: auto !important;
  min-height: var(--n-height);
  align-items: center;
}

/*
 * Collapse the filter <input> to zero width when the selector is closed
 * (not active). This prevents the input from stealing horizontal space from
 * the render-tag overlay.
 */
.training-run-select-input :deep(.n-base-selection:not(.n-base-selection--active) .n-base-selection-input),
.study-select :deep(.n-base-selection:not(.n-base-selection--active) .n-base-selection-input) {
  width: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  flex: 0 0 0 !important;
  min-width: 0 !important;
  overflow: hidden !important;
}

/*
 * Re-flow the render-label overlay into flex so the parent grows to contain
 * the wrapped text (it's position: absolute by default).
 */
.training-run-select-input :deep(.n-base-selection-label__render-label),
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

.training-run-select-input :deep(.n-base-selection-overlay__wrapper),
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
.training-run-select-input :deep(.n-base-select-option),
.study-select :deep(.n-base-select-option) {
  min-height: calc(var(--n-option-height) + 8px);
  align-items: flex-start;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}

.training-run-select-input :deep(.n-base-select-option__content),
.study-select :deep(.n-base-select-option__content) {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: unset !important;
  line-height: 1.4;
}
</style>
