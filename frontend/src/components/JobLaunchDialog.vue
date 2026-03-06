<script setup lang="ts">
import { ref, computed, onMounted, watch, h } from 'vue'
import {
  NModal,
  NSelect,
  NInputNumber,
  NButton,
  NSpace,
  NAlert,
  NDivider,
  NCheckbox,
  NTag,
  NTooltip,
} from 'naive-ui'
import type { SelectRenderLabel } from 'naive-ui'
import type { TrainingRun, Study, StudyAvailability, WorkflowSummary, CreateSampleJobPayload, SampleJob, ValidationResult } from '../api/types'
import { apiClient } from '../api/client'
import StudyEditor from './StudyEditor.vue'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'

/** Status of a training run used to determine bead color. */
type TrainingRunStatus = 'complete' | 'complete_with_errors' | 'running' | 'queued' | 'empty'

const props = defineProps<{
  show: boolean
  /** Incremented by the parent when a job completes via WebSocket, triggering a data refresh. */
  refreshTrigger?: number
  /** When set, pre-populates the dialog with the given job's settings for regeneration. */
  prefillJob?: SampleJob | null
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
const workflows = ref<WorkflowSummary[]>([])
const studies = ref<Study[]>([])
const vaeModels = ref<string[]>([])
const clipModels = ref<string[]>([])

// Study sample availability for the selected training run
const studyAvailability = ref<StudyAvailability[]>([])

// Study editor sub-dialog
const studyEditorOpen = ref(false)

// Training run filter: when true, show all runs; when false, show only gray (empty) runs
const showAllRuns = ref(true)

// Form selections
const selectedTrainingRunId = ref<number | null>(null)
const selectedWorkflow = ref<string | null>(null)
const selectedStudy = ref<string | null>(null)
const selectedVAE = ref<string | null>(null)
const selectedCLIP = ref<string | null>(null)
const shiftValue = ref<number | null>(null)

// Checkpoint selection for regeneration
const selectedCheckpoints = ref<Set<string>>(new Set())

// Whether to clear existing sample directories for selected checkpoints
const clearExisting = ref(false)

// Whether to generate only missing samples (skip existing output files)
const missingOnly = ref(false)

// Validation preview state
const validationResult = ref<ValidationResult | null>(null)
const validating = ref(false)

// When true, the training run watcher skips checkpoint auto-selection to allow
// applyPrefill to control checkpoint selection instead.
const prefillActive = ref(false)

// Current model type derived from the first checkpoint's ss_base_model_version metadata
const currentModelType = ref<string | null>(null)

// Persistence composable
const persistence = useGenerateInputsPersistence()

// Computed: the selected training run object
const selectedTrainingRun = computed(() =>
  trainingRuns.value.find(r => r.id === selectedTrainingRunId.value) ?? null
)

// Compute status per training run based on job list
function getRunStatus(run: TrainingRun): TrainingRunStatus {
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

// Bead color per status
function beadColor(status: TrainingRunStatus): string {
  switch (status) {
    case 'complete': return '#18a058'            // green
    case 'complete_with_errors': return '#d03050' // red
    case 'running': return '#2080f0'              // blue
    case 'queued': return '#f0a020'               // yellow/amber
    case 'empty': return '#909090'                // gray
  }
}

// renderLabel function for the training run NSelect.
// NSelect does not support a #option slot — custom option rendering must be
// done via the renderLabel prop (a render function returning VNodeChild).
//
// IMPORTANT: VNodes returned from renderLabel are rendered outside Vue's scoped
// compilation context, so scoped CSS classes (e.g. .status-bead) are NOT applied.
// All styles must be inlined directly on the element.
const renderTrainingRunLabel: SelectRenderLabel = (option) => {
  const color = (option as { _color?: string })._color ?? '#909090'
  const status = (option as { _status?: string })._status ?? 'empty'
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, [
    h('span', {
      style: {
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        flexShrink: '0',
        backgroundColor: color,
      },
      title: status,
    }),
    h('span', {}, String(option.label ?? '')),
  ])
}

// Training run select options (filtered by showAllRuns)
const trainingRunOptions = computed(() => {
  return trainingRuns.value
    .filter(run => {
      if (showAllRuns.value) return true
      return getRunStatus(run) === 'empty'
    })
    .map(run => {
      const status = getRunStatus(run)
      const color = beadColor(status)
      return {
        label: run.name,
        value: run.id,
        // Custom rendering via renderLabel
        _status: status,
        _color: color,
      }
    })
})

// Whether the selected run has any existing samples or active jobs
const selectedRunHasSamples = computed(() => {
  const run = selectedTrainingRun.value
  if (!run) return false
  const status = getRunStatus(run)
  return status === 'complete' || status === 'complete_with_errors' || status === 'running' || status === 'queued'
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
  currentModelType.value = null
  validationResult.value = null


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

    // Auto-enable clear_existing when run has existing samples
    if (selectedRunHasSamples.value) {
      clearExisting.value = true
    }
  }

  // Fetch metadata for the first checkpoint to determine the model type
  const firstCheckpoint = run.checkpoints[0]
  try {
    const metadataResult = await apiClient.getCheckpointMetadata(firstCheckpoint.filename)
    const modelType = metadataResult.metadata['ss_base_model_version'] ?? null
    currentModelType.value = modelType

    if (modelType && !skipAutoSelection) {
      restoreModelInputs(modelType)
    }
  } catch {
    // Metadata fetch failure is non-fatal; proceed without model-type restoration
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

// Persist training run selection changes (AC3)
watch(selectedTrainingRunId, (runId) => {
  if (runId !== null) {
    persistence.saveTrainingRunId(runId)
  }
})

// Persist workflow selection changes (AC3: per model type when model type is known, global fallback otherwise)
watch(selectedWorkflow, (workflowId) => {
  if (currentModelType.value) {
    persistence.saveWorkflowIdForModelType(currentModelType.value, workflowId)
  } else {
    // No model type known yet — save globally as fallback
    persistence.saveWorkflowId(workflowId)
  }
})

// Persist study selection changes
watch(selectedStudy, (studyId) => {
  persistence.saveStudyId(studyId)
})

// Persist model-type-specific input changes
watch([selectedVAE, selectedCLIP, shiftValue], () => {
  if (!currentModelType.value) return
  persistence.saveModelInputs(currentModelType.value, {
    vae: selectedVAE.value,
    clip: selectedCLIP.value,
    shift: shiftValue.value,
  })
})

/**
 * Restore model-type-specific inputs from persistence, filtering any values
 * that are no longer available in the current model/clip lists.
 * Also restores the per-model-type workflow preference (AC3).
 */
function restoreModelInputs(modelType: string) {
  const saved = persistence.getModelInputs(modelType)
  if (saved) {
    // Restore VAE only if still available
    if (saved.vae !== null && vaeModels.value.includes(saved.vae)) {
      selectedVAE.value = saved.vae
    } else {
      selectedVAE.value = null
    }

    // Restore CLIP only if still available
    if (saved.clip !== null && clipModels.value.includes(saved.clip)) {
      selectedCLIP.value = saved.clip
    } else {
      selectedCLIP.value = null
    }

    // Restore shift value (no availability check needed — it's a free numeric value)
    shiftValue.value = saved.shift
  }

  // AC3: Restore per-model-type workflow preference, if not already set by the single-workflow auto-select
  const validWorkflows = workflows.value.filter(w => w.validation_state === 'valid')
  if (validWorkflows.length !== 1) {
    // Only override workflow if it was not already auto-selected (single workflow)
    const modelWorkflowId = persistence.getWorkflowIdForModelType(modelType)
    if (modelWorkflowId !== null) {
      const isAvailable = workflows.value.some(
        w => w.name === modelWorkflowId && w.validation_state === 'valid'
      )
      if (isAvailable) {
        selectedWorkflow.value = modelWorkflowId
      }
    }
  }
}

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

const workflowOptions = computed(() =>
  workflows.value
    .filter(w => w.validation_state === 'valid')
    .map(w => ({
      label: w.name,
      value: w.name,
    }))
)

// AC3: Study options include sample availability info. When availability data is present,
// each study is shown with a bead indicating sample availability for the selected training run.
const studyOptions = computed(() => {
  return studies.value.map(p => {
    const avail = studyAvailability.value.find(a => a.study_id === p.id)
    const hasSamples = avail?.has_samples ?? false

    return {
      label: p.name,
      value: p.id,
      // Metadata for bead rendering
      _hasSamples: hasSamples,
      _hasAvailability: avail !== undefined,
    }
  })
})

// AC2: renderLabel function for the study NSelect, showing green bead for studies with samples.
const renderStudyLabel: SelectRenderLabel = (option) => {
  const hasSamples = (option as { _hasSamples?: boolean })._hasSamples ?? false
  const color = hasSamples ? '#18a058' : 'transparent'
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, [
    h('span', {
      style: {
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        flexShrink: '0',
        backgroundColor: color,
        border: hasSamples ? 'none' : '1px solid var(--border-color, #ccc)',
      },
    }),
    h('span', {}, String(option.label ?? '')),
  ])
}

const vaeOptions = computed(() =>
  vaeModels.value.map(v => ({
    label: v,
    value: v,
  }))
)

const clipOptions = computed(() =>
  clipModels.value.map(c => ({
    label: c,
    value: c,
  }))
)

const selectedWorkflowDetail = computed(() =>
  workflows.value.find(w => w.name === selectedWorkflow.value)
)

const hasShiftRole = computed(() => {
  const workflow = selectedWorkflowDetail.value
  if (!workflow) return false
  return 'shift' in workflow.roles
})

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
    selectedWorkflow.value !== null &&
    selectedStudy.value !== null &&
    selectedVAE.value !== null &&
    selectedCLIP.value !== null &&
    (!hasShiftRole.value || shiftValue.value !== null) &&
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
    fetchWorkflows(),
    fetchStudies(),
    fetchVAEModels(),
    fetchCLIPModels(),
  ])

  applyPrefill(props.prefillJob)
})

onMounted(async () => {
  await Promise.all([
    fetchTrainingRunsAndJobs(),
    fetchWorkflows(),
    fetchStudies(),
    fetchVAEModels(),
    fetchCLIPModels(),
  ])

  // If a prefill job is provided, apply its settings instead of restoring from persistence
  if (props.prefillJob) {
    applyPrefill(props.prefillJob)
    return
  }

  // AC1: If exactly one valid workflow exists, auto-select it.
  // AC3/AC2: If multiple valid workflows exist, restore from localStorage.
  //   - Prefer the per-model-type workflow when a model type is already known.
  //   - Fall back to the global lastWorkflowId (legacy / no model type yet).
  const validWorkflows = workflows.value.filter(w => w.validation_state === 'valid')
  if (validWorkflows.length === 1) {
    selectedWorkflow.value = validWorkflows[0].name
  } else {
    // Try per-model-type first (will be null if no model type is determined yet at mount)
    const modelTypeWorkflowId = currentModelType.value
      ? persistence.getWorkflowIdForModelType(currentModelType.value)
      : null
    const lastWorkflowId = modelTypeWorkflowId ?? persistence.getLastWorkflowId()
    if (lastWorkflowId !== null) {
      const isAvailable = workflows.value.some(
        w => w.name === lastWorkflowId && w.validation_state === 'valid'
      )
      if (isAvailable) {
        selectedWorkflow.value = lastWorkflowId
      }
    }
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

async function fetchWorkflows() {
  try {
    workflows.value = await apiClient.listWorkflows()
  } catch {
    workflows.value = []
  }
}

async function fetchStudies() {
  try {
    studies.value = await apiClient.listStudies()
  } catch {
    studies.value = []
  }
}

async function fetchVAEModels() {
  try {
    const result = await apiClient.getComfyUIModels('vae')
    vaeModels.value = result.models
  } catch {
    vaeModels.value = []
  }
}

async function fetchCLIPModels() {
  try {
    const result = await apiClient.getComfyUIModels('clip')
    clipModels.value = result.models
  } catch {
    clipModels.value = []
  }
}

function close() {
  emit('update:show', false)
  resetForm()
}

function resetForm() {
  selectedTrainingRunId.value = null
  selectedWorkflow.value = null
  selectedStudy.value = null
  selectedVAE.value = null
  selectedCLIP.value = null
  shiftValue.value = null
  selectedCheckpoints.value = new Set()
  clearExisting.value = false
  missingOnly.value = false
  currentModelType.value = null
  showAllRuns.value = true
  prefillActive.value = false
  validationResult.value = null
  validating.value = false
  studyAvailability.value = []
  error.value = null
  validationResult.value = null

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

  // Set workflow, study, VAE, CLIP, shift from the job
  selectedWorkflow.value = job.workflow_name
  selectedStudy.value = job.study_id
  selectedVAE.value = job.vae || null
  selectedCLIP.value = job.clip || null
  shiftValue.value = job.shift ?? null

  // Handle checkpoint selection based on job status
  if (job.status === 'completed_with_errors' && job.failed_item_details && job.failed_item_details.length > 0) {
    // For completed_with_errors jobs, pre-select only failed checkpoints
    const failedFilenames = new Set(job.failed_item_details.map(d => d.checkpoint_filename))
    selectedCheckpoints.value = failedFilenames
  } else if (run.has_samples) {
    // For completed jobs, select all checkpoints
    selectedCheckpoints.value = new Set(run.checkpoints.map(c => c.filename))
  }

  // Auto-enable clear_existing for runs with existing samples
  if (run.has_samples) {
    clearExisting.value = true
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

async function submit() {
  if (!canSubmit.value || !selectedTrainingRun.value) return

  loading.value = true
  error.value = null

  try {
    const payload: CreateSampleJobPayload = {
      training_run_name: selectedTrainingRun.value.name,
      study_id: selectedStudy.value!,
      workflow_name: selectedWorkflow.value!,
      vae: selectedVAE.value ?? '',
      clip: selectedCLIP.value ?? '',
    }

    if (hasShiftRole.value && shiftValue.value !== null) {
      payload.shift = shiftValue.value
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
        <NSelect
          id="training-run-select"
          v-model:value="selectedTrainingRunId"
          :options="trainingRunOptions"
          :render-label="renderTrainingRunLabel"
          placeholder="Select a training run"
          clearable
          filterable
          data-testid="training-run-select"
        />
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

      <div class="form-field">
        <label for="workflow-select">Workflow Template</label>
        <NSelect
          id="workflow-select"
          v-model:value="selectedWorkflow"
          :options="workflowOptions"
          placeholder="Select a workflow"
          clearable
          data-testid="workflow-select"
        />
      </div>

      <div class="form-field">
        <label for="vae-select">VAE</label>
        <NSelect
          key="vae-select"
          id="vae-select"
          v-model:value="selectedVAE"
          :options="vaeOptions"
          placeholder="Select a VAE model"
          clearable
          filterable
          data-testid="vae-select"
        />
      </div>

      <div class="form-field">
        <label for="clip-select">CLIP / Text Encoder</label>
        <NSelect
          key="clip-select"
          id="clip-select"
          v-model:value="selectedCLIP"
          :options="clipOptions"
          placeholder="Select a CLIP model"
          clearable
          filterable
          data-testid="clip-select"
        />
      </div>

      <div v-if="hasShiftRole" class="form-field">
        <label for="shift-input">Shift Value</label>
        <NInputNumber
          id="shift-input"
          v-model:value="shiftValue"
          :min="0"
          :step="0.1"
          placeholder="Enter shift value"
          style="width: 100%;"
          data-testid="shift-input"
        />
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
</style>
