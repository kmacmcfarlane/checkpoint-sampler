<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NModal, NCard, NSelect, NInputNumber, NButton, NSpace, NAlert, NDivider } from 'naive-ui'
import type { TrainingRun, SamplePreset, WorkflowSummary, CreateSampleJobPayload } from '../api/types'
import { apiClient } from '../api/client'
import SamplePresetEditor from './SamplePresetEditor.vue'

const props = defineProps<{
  show: boolean
  trainingRun: TrainingRun | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  success: []
}>()

const loading = ref(false)
const error = ref<string | null>(null)

// Available options
const workflows = ref<WorkflowSummary[]>([])
const samplePresets = ref<SamplePreset[]>([])
const vaeModels = ref<string[]>([])
const clipModels = ref<string[]>([])

// Preset editor sub-dialog
const presetEditorOpen = ref(false)

// Form selections
const selectedWorkflow = ref<string | null>(null)
const selectedPreset = ref<string | null>(null)
const selectedVAE = ref<string | null>(null)
const selectedCLIP = ref<string | null>(null)
const shiftValue = ref<number | null>(null)

const workflowOptions = computed(() =>
  workflows.value
    .filter(w => w.validation_state === 'valid')
    .map((w) => ({
      label: w.name,
      value: w.name,
    }))
)

const presetOptions = computed(() =>
  samplePresets.value.map((p) => ({
    label: p.name,
    value: p.id,
  }))
)

const vaeOptions = computed(() =>
  vaeModels.value.map((v) => ({
    label: v,
    value: v,
  }))
)

const clipOptions = computed(() =>
  clipModels.value.map((c) => ({
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

const totalCheckpoints = computed(() => {
  return props.trainingRun?.checkpoint_count ?? 0
})

const imagesPerCheckpoint = computed(() => {
  return selectedPresetDetail.value?.images_per_checkpoint ?? 0
})

const totalImages = computed(() => {
  return totalCheckpoints.value * imagesPerCheckpoint.value
})

const canSubmit = computed(() => {
  return (
    selectedWorkflow.value !== null &&
    selectedPreset.value !== null &&
    selectedVAE.value !== null &&
    selectedCLIP.value !== null &&
    (!hasShiftRole.value || shiftValue.value !== null)
  )
})

onMounted(async () => {
  await Promise.all([
    fetchWorkflows(),
    fetchSamplePresets(),
    fetchVAEModels(),
    fetchCLIPModels(),
  ])
})

async function fetchWorkflows() {
  try {
    workflows.value = await apiClient.listWorkflows()
  } catch (err: unknown) {
    // Silently fail - will be empty
    workflows.value = []
  }
}

async function fetchSamplePresets() {
  try {
    samplePresets.value = await apiClient.listSamplePresets()
  } catch (err: unknown) {
    samplePresets.value = []
  }
}

async function fetchVAEModels() {
  try {
    const result = await apiClient.getComfyUIModels('vae')
    vaeModels.value = result.models
  } catch (err: unknown) {
    vaeModels.value = []
  }
}

async function fetchCLIPModels() {
  try {
    const result = await apiClient.getComfyUIModels('clip')
    clipModels.value = result.models
  } catch (err: unknown) {
    clipModels.value = []
  }
}

function close() {
  emit('update:show', false)
  resetForm()
}

function resetForm() {
  selectedWorkflow.value = null
  selectedPreset.value = null
  selectedVAE.value = null
  selectedCLIP.value = null
  shiftValue.value = null
  error.value = null
}

function openPresetEditor() {
  presetEditorOpen.value = true
}

function closePresetEditor() {
  presetEditorOpen.value = false
}

async function onPresetSaved(preset: SamplePreset) {
  // Refresh the preset list and auto-select the newly saved preset
  await fetchSamplePresets()
  selectedPreset.value = preset.id
}

async function onPresetDeleted(presetId: string) {
  // If the deleted preset was selected, clear the selection
  if (selectedPreset.value === presetId) {
    selectedPreset.value = null
  }
  await fetchSamplePresets()
}

async function submit() {
  if (!canSubmit.value || !props.trainingRun) return

  loading.value = true
  error.value = null

  try {
    const payload: CreateSampleJobPayload = {
      training_run_name: props.trainingRun.name,
      sample_preset_id: selectedPreset.value!,
      workflow_name: selectedWorkflow.value!,
      vae: selectedVAE.value ?? '',
      clip: selectedCLIP.value ?? '',
    }

    if (hasShiftRole.value && shiftValue.value !== null) {
      payload.shift = shiftValue.value
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
    style="max-width: 600px;"
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
        <p><strong>Training Run:</strong> {{ trainingRun?.name ?? 'N/A' }}</p>
        <p><strong>Checkpoints:</strong> {{ totalCheckpoints }}</p>
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
          {{ loading ? 'Creating...' : 'Generate Samples' }}
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

.summary {
  padding: 1rem;
  background: var(--bg-surface, #f5f5f5);
  border-radius: 0.25rem;
}

.summary p {
  margin: 0.5rem 0;
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
