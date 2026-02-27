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
} from 'naive-ui'
import type { SelectRenderLabel } from 'naive-ui'
import type { TrainingRun, SamplePreset, WorkflowSummary, CreateSampleJobPayload, SampleJob } from '../api/types'
import { apiClient } from '../api/client'
import SamplePresetEditor from './SamplePresetEditor.vue'
import { useGenerateInputsPersistence } from '../composables/useGenerateInputsPersistence'

/** Status of a training run used to determine bead color. */
type TrainingRunStatus = 'complete' | 'running' | 'queued' | 'empty'

const props = defineProps<{
  show: boolean
}>()

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
const samplePresets = ref<SamplePreset[]>([])
const vaeModels = ref<string[]>([])
const clipModels = ref<string[]>([])

// Preset editor sub-dialog
const presetEditorOpen = ref(false)

// Training run filter: when false, show only gray (empty) runs
const showAllRuns = ref(false)

// Form selections
const selectedTrainingRunId = ref<number | null>(null)
const selectedWorkflow = ref<string | null>(null)
const selectedPreset = ref<string | null>(null)
const selectedVAE = ref<string | null>(null)
const selectedCLIP = ref<string | null>(null)
const shiftValue = ref<number | null>(null)

// Checkpoint selection for regeneration
const selectedCheckpoints = ref<Set<string>>(new Set())

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
  if (hasRunning) return 'running'
  if (hasQueued) return 'queued'
  if (run.has_samples) return 'complete'
  return 'empty'
}

// Bead color per status
function beadColor(status: TrainingRunStatus): string {
  switch (status) {
    case 'complete': return '#18a058' // green
    case 'running': return '#2080f0'  // blue
    case 'queued': return '#f0a020'   // yellow/amber
    case 'empty': return '#909090'    // gray
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
  return status === 'complete' || status === 'running' || status === 'queued'
})

// Checkpoints of the selected training run
const selectedRunCheckpoints = computed(() => selectedTrainingRun.value?.checkpoints ?? [])

// Initialize checkpoint selections and restore persisted inputs when the training run changes
watch(selectedTrainingRunId, async () => {
  selectedCheckpoints.value = new Set()
  currentModelType.value = null

  const run = selectedTrainingRun.value
  if (!run || run.checkpoints.length === 0) return

  // Fetch metadata for the first checkpoint to determine the model type
  const firstCheckpoint = run.checkpoints[0]
  try {
    const metadataResult = await apiClient.getCheckpointMetadata(firstCheckpoint.filename)
    const modelType = metadataResult.metadata['ss_base_model_version'] ?? null
    currentModelType.value = modelType

    if (modelType) {
      restoreModelInputs(modelType)
    }
  } catch {
    // Metadata fetch failure is non-fatal; proceed without model-type restoration
  }
})

// Persist workflow selection changes
watch(selectedWorkflow, (workflowId) => {
  persistence.saveWorkflowId(workflowId)
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
 */
function restoreModelInputs(modelType: string) {
  const saved = persistence.getModelInputs(modelType)
  if (!saved) return

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

function selectAllCheckpoints() {
  selectedCheckpoints.value = new Set(selectedRunCheckpoints.value.map(c => c.filename))
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

const presetOptions = computed(() =>
  samplePresets.value.map(p => ({
    label: p.name,
    value: p.id,
  }))
)

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

const selectedPresetDetail = computed(() =>
  samplePresets.value.find(p => p.id === selectedPreset.value)
)

// Effective checkpoints to use: if picker is shown and checkpoints are selected, use them;
// otherwise all checkpoints (empty array = all)
const effectiveCheckpointFilenames = computed((): string[] | undefined => {
  if (!selectedRunHasSamples.value) return undefined
  if (selectedCheckpoints.value.size === 0) return undefined
  return Array.from(selectedCheckpoints.value)
})

// How many checkpoints will be targeted
const targetedCheckpointCount = computed(() => {
  if (!selectedRunHasSamples.value) {
    return selectedTrainingRun.value?.checkpoint_count ?? 0
  }
  // If checkpoints are selected, use that count; otherwise all
  if (selectedCheckpoints.value.size > 0) {
    return selectedCheckpoints.value.size
  }
  return selectedTrainingRun.value?.checkpoint_count ?? 0
})

const totalCheckpoints = computed(() => selectedTrainingRun.value?.checkpoint_count ?? 0)

const imagesPerCheckpoint = computed(() =>
  selectedPresetDetail.value?.images_per_checkpoint ?? 0
)

const totalImages = computed(() => targetedCheckpointCount.value * imagesPerCheckpoint.value)

const canSubmit = computed(() => {
  return (
    selectedTrainingRunId.value !== null &&
    selectedWorkflow.value !== null &&
    selectedPreset.value !== null &&
    selectedVAE.value !== null &&
    selectedCLIP.value !== null &&
    (!hasShiftRole.value || shiftValue.value !== null)
  )
})

onMounted(async () => {
  await Promise.all([
    fetchTrainingRunsAndJobs(),
    fetchWorkflows(),
    fetchSamplePresets(),
    fetchVAEModels(),
    fetchCLIPModels(),
  ])

  // Restore last used workflow (only if it's still available as a valid workflow)
  const lastWorkflowId = persistence.getLastWorkflowId()
  if (lastWorkflowId !== null) {
    const isAvailable = workflows.value.some(
      w => w.name === lastWorkflowId && w.validation_state === 'valid'
    )
    if (isAvailable) {
      selectedWorkflow.value = lastWorkflowId
    }
  }
})

async function fetchTrainingRunsAndJobs() {
  try {
    const [runs, jobs] = await Promise.all([
      apiClient.getTrainingRuns(),
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

async function fetchSamplePresets() {
  try {
    samplePresets.value = await apiClient.listSamplePresets()
  } catch {
    samplePresets.value = []
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
  selectedPreset.value = null
  selectedVAE.value = null
  selectedCLIP.value = null
  shiftValue.value = null
  selectedCheckpoints.value = new Set()
  currentModelType.value = null
  showAllRuns.value = false
  error.value = null
}

function openPresetEditor() {
  presetEditorOpen.value = true
}

function closePresetEditor() {
  presetEditorOpen.value = false
}

async function onPresetSaved(preset: SamplePreset) {
  await fetchSamplePresets()
  selectedPreset.value = preset.id
}

async function onPresetDeleted(presetId: string) {
  if (selectedPreset.value === presetId) {
    selectedPreset.value = null
  }
  await fetchSamplePresets()
}

async function submit() {
  if (!canSubmit.value || !selectedTrainingRun.value) return

  loading.value = true
  error.value = null

  try {
    const payload: CreateSampleJobPayload = {
      training_run_name: selectedTrainingRun.value.name,
      sample_preset_id: selectedPreset.value!,
      workflow_name: selectedWorkflow.value!,
      vae: selectedVAE.value ?? '',
      clip: selectedCLIP.value ?? '',
    }

    if (hasShiftRole.value && shiftValue.value !== null) {
      payload.shift = shiftValue.value
    }

    if (selectedRunHasSamples.value) {
      payload.clear_existing = true
      if (effectiveCheckpointFilenames.value) {
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
      :show="presetEditorOpen"
      preset="card"
      title="Manage Sample Presets"
      style="max-width: 860px;"
      :on-close="closePresetEditor"
      @update:show="presetEditorOpen = $event"
    >
      <SamplePresetEditor
        @preset-saved="onPresetSaved"
        @preset-deleted="onPresetDeleted"
      />
    </NModal>

    <NSpace vertical :size="16">
      <NAlert v-if="error" type="error" closable @close="error = null">
        {{ error }}
      </NAlert>

      <!-- Training run selector -->
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

      <!-- Checkpoint picker (only shown when run has existing samples) -->
      <div
        v-if="selectedRunHasSamples && selectedRunCheckpoints.length > 0"
        class="form-field"
        data-testid="checkpoint-picker"
      >
        <div class="field-header">
          <label>Checkpoints to Regenerate</label>
          <div class="checkpoint-controls">
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
        <p class="field-hint">
          {{ selectedCheckpoints.size === 0 ? 'All checkpoints selected (none deselected)' : `${selectedCheckpoints.size} of ${selectedRunCheckpoints.length} selected` }}
        </p>
        <div class="checkpoint-list">
          <div
            v-for="cp in selectedRunCheckpoints"
            :key="cp.filename"
            class="checkpoint-row"
            :data-testid="`checkpoint-row-${cp.filename}`"
          >
            <NCheckbox
              :checked="selectedCheckpoints.has(cp.filename)"
              @update:checked="toggleCheckpoint(cp.filename)"
            >
              <span class="checkpoint-filename">{{ cp.filename }}</span>
              <NTag
                v-if="cp.has_samples"
                size="tiny"
                type="success"
                class="has-samples-tag"
              >
                has samples
              </NTag>
            </NCheckbox>
          </div>
        </div>
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
        <label for="preset-select">Sample Preset</label>
        <div class="preset-field-row">
          <NSelect
            id="preset-select"
            v-model:value="selectedPreset"
            :options="presetOptions"
            placeholder="Select a sample preset"
            clearable
            data-testid="preset-select"
            class="preset-select"
          />
          <NButton
            size="medium"
            data-testid="manage-presets-button"
            @click="openPresetEditor"
          >
            Manage Presets
          </NButton>
        </div>
      </div>

      <div class="form-field">
        <label for="vae-select">VAE</label>
        <NSelect
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

.preset-field-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.preset-select {
  flex: 1;
}

.form-field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color);
}

.field-hint {
  font-size: 0.8125rem;
  color: var(--text-secondary, #666666);
  margin: 0;
}

.checkpoint-controls {
  display: flex;
  gap: 0.375rem;
}

.checkpoint-list {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 0.25rem;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.checkpoint-row {
  display: flex;
  align-items: center;
}

.checkpoint-filename {
  font-family: monospace;
  font-size: 0.8125rem;
}

.has-samples-tag {
  margin-left: 0.5rem;
}

.summary {
  padding: 1rem;
  background: var(--bg-surface, #f5f5f5);
  border-radius: 0.25rem;
}

.summary p {
  margin: 0.5rem 0;
  color: var(--text-color, #333333);
}

.summary .total-images {
  font-size: 1.125rem;
  color: var(--accent-color, #1976d2);
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}
</style>
