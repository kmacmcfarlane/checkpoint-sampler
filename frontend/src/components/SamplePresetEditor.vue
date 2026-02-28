<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput, NInputNumber, NSelect, NButton, NDynamicInput, NDynamicTags, NCard, NSpace, NAlert } from 'naive-ui'
import type { SamplePreset, NamedPrompt, CreateSamplePresetPayload, UpdateSamplePresetPayload } from '../api/types'
import { apiClient } from '../api/client'

// initialPresetId: When provided, the preset with this ID is pre-selected after presets load.
// If null or the ID is not found in the loaded presets, no preset is selected (default behavior).
const props = withDefaults(defineProps<{
  initialPresetId?: string | null
}>(), {
  initialPresetId: null,
})

// preset-saved: Emitted after a preset is created or updated. Payload: the saved SamplePreset.
// preset-deleted: Emitted after a preset is deleted. Payload: the deleted preset's ID (string).
const emit = defineEmits<{
  'preset-saved': [preset: SamplePreset]
  'preset-deleted': [presetId: string]
}>()

const presets = ref<SamplePreset[]>([])
const selectedPresetId = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

// Form fields
const presetName = ref('')
const prompts = ref<NamedPrompt[]>([{ name: '', text: '' }])
const negativePrompt = ref('')
const steps = ref<number[]>([30])
const cfgs = ref<number[]>([7.0])
const samplers = ref<string[]>([])
const schedulers = ref<string[]>([])
const seeds = ref<number[]>([42])
const width = ref(1024)
const height = ref(1024)

// Available options from ComfyUI
const availableSamplers = ref<string[]>([])
const availableSchedulers = ref<string[]>([])

const selectedPreset = computed(() =>
  presets.value.find(p => p.id === selectedPresetId.value) ?? null
)

const selectOptions = computed(() =>
  presets.value.map((p) => ({
    label: p.name,
    value: p.id,
  }))
)

const samplerOptions = computed(() =>
  availableSamplers.value.map((s) => ({
    label: s,
    value: s,
  }))
)

const schedulerOptions = computed(() =>
  availableSchedulers.value.map((s) => ({
    label: s,
    value: s,
  }))
)

// String representations for NDynamicTags
const stepsAsStrings = computed(() => steps.value.map(String))
const cfgsAsStrings = computed(() => cfgs.value.map(String))
const seedsAsStrings = computed(() => seeds.value.map(String))

// Input props to restrict entry to digits and '.' only
const numericInputProps = {
  allowInput: (val: string) => /^[0-9.]*$/.test(val),
}

const computedTotalImages = computed(() => {
  const validPrompts = prompts.value.filter(p => p != null && p.name && p.text)
  return (
    validPrompts.length *
    steps.value.length *
    cfgs.value.length *
    samplers.value.length *
    schedulers.value.length *
    seeds.value.length
  )
})

const canSave = computed(() => {
  return (
    presetName.value.trim() !== '' &&
    prompts.value.some(p => p != null && p.name.trim() !== '' && p.text.trim() !== '') &&
    steps.value.length > 0 &&
    cfgs.value.length > 0 &&
    samplers.value.length > 0 &&
    schedulers.value.length > 0 &&
    seeds.value.length > 0 &&
    width.value > 0 &&
    height.value > 0
  )
})

onMounted(async () => {
  await Promise.all([
    fetchPresets(),
    fetchSamplers(),
    fetchSchedulers(),
  ])

  // After presets are loaded, pre-select the preset from the parent dialog if one was provided.
  if (props.initialPresetId !== null) {
    const match = presets.value.find(p => p.id === props.initialPresetId)
    if (match) {
      onSelectPreset(match.id)
    }
  }
})

async function fetchPresets() {
  loading.value = true
  error.value = null
  try {
    presets.value = await apiClient.listSamplePresets()
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to load presets'
    error.value = message
  } finally {
    loading.value = false
  }
}

async function fetchSamplers() {
  try {
    const result = await apiClient.getComfyUIModels('sampler')
    availableSamplers.value = result.models
  } catch (err: unknown) {
    // Silently fail - ComfyUI might not be available
    availableSamplers.value = []
  }
}

async function fetchSchedulers() {
  try {
    const result = await apiClient.getComfyUIModels('scheduler')
    availableSchedulers.value = result.models
  } catch (err: unknown) {
    // Silently fail - ComfyUI might not be available
    availableSchedulers.value = []
  }
}

function onSelectPreset(value: string | null) {
  selectedPresetId.value = value
  if (!value) {
    resetForm()
    return
  }
  const preset = presets.value.find(p => p.id === value)
  if (preset) {
    loadPreset(preset)
  }
}

function loadPreset(preset: SamplePreset) {
  presetName.value = preset.name
  prompts.value = [...preset.prompts]
  negativePrompt.value = preset.negative_prompt
  steps.value = [...preset.steps]
  cfgs.value = [...preset.cfgs]
  samplers.value = [...preset.samplers]
  schedulers.value = [...preset.schedulers]
  seeds.value = [...preset.seeds]
  width.value = preset.width
  height.value = preset.height
}

function resetForm() {
  presetName.value = ''
  prompts.value = [{ name: '', text: '' }]
  negativePrompt.value = ''
  steps.value = [30]
  cfgs.value = [7.0]
  samplers.value = []
  schedulers.value = []
  seeds.value = [42]
  width.value = 1024
  height.value = 1024
}

function createNewPreset() {
  selectedPresetId.value = null
  resetForm()
}

async function savePreset() {
  if (!canSave.value) return

  saving.value = true
  error.value = null
  try {
    // Filter out empty prompts
    const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')

    const payload: CreateSamplePresetPayload | UpdateSamplePresetPayload = selectedPresetId.value
      ? {
          id: selectedPresetId.value,
          name: presetName.value.trim(),
          prompts: validPrompts,
          negative_prompt: negativePrompt.value,
          steps: steps.value,
          cfgs: cfgs.value,
          samplers: samplers.value,
          schedulers: schedulers.value,
          seeds: seeds.value,
          width: width.value,
          height: height.value,
        }
      : {
          name: presetName.value.trim(),
          prompts: validPrompts,
          negative_prompt: negativePrompt.value,
          steps: steps.value,
          cfgs: cfgs.value,
          samplers: samplers.value,
          schedulers: schedulers.value,
          seeds: seeds.value,
          width: width.value,
          height: height.value,
        }

    const result = selectedPresetId.value
      ? await apiClient.updateSamplePreset(payload as UpdateSamplePresetPayload)
      : await apiClient.createSamplePreset(payload as CreateSamplePresetPayload)

    // Update presets list
    if (selectedPresetId.value) {
      const index = presets.value.findIndex(p => p.id === selectedPresetId.value)
      if (index !== -1) {
        presets.value[index] = result
      }
    } else {
      presets.value.push(result)
      selectedPresetId.value = result.id
    }
    emit('preset-saved', result)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to save preset'
    error.value = message
  } finally {
    saving.value = false
  }
}

async function deletePreset() {
  if (!selectedPresetId.value) return

  const confirmed = confirm(`Delete preset "${presetName.value}"?`)
  if (!confirmed) return

  error.value = null
  try {
    const deletedId = selectedPresetId.value
    await apiClient.deleteSamplePreset(selectedPresetId.value)
    presets.value = presets.value.filter(p => p.id !== selectedPresetId.value)
    resetForm()
    selectedPresetId.value = null
    emit('preset-deleted', deletedId)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to delete preset'
    error.value = message
  }
}

function createPromptItem(): NamedPrompt {
  return { name: '', text: '' }
}

function onUpdateSteps(tags: string[]) {
  steps.value = tags.map(s => parseFloat(s)).filter(n => !isNaN(n))
}

function onUpdateCfgs(tags: string[]) {
  cfgs.value = tags.map(s => parseFloat(s)).filter(n => !isNaN(n))
}

function onUpdateSeeds(tags: string[]) {
  seeds.value = tags.map(s => parseFloat(s)).filter(n => !isNaN(n))
}
</script>

<template>
  <div class="sample-preset-editor">
    <NCard title="Sample Preset Editor">
      <NSpace vertical :size="16">
        <NAlert v-if="error" type="error" closable @close="error = null">
          {{ error }}
        </NAlert>

        <div class="preset-controls">
          <NSelect
            :value="selectedPresetId"
            :options="selectOptions"
            :disabled="loading"
            :placeholder="loading ? 'Loading...' : 'Select a preset'"
            :loading="loading"
            clearable
            class="preset-select"
            size="medium"
            data-testid="preset-editor-select"
            @update:value="onSelectPreset"
          />
          <NButton
            size="medium"
            data-testid="new-preset-button"
            @click="createNewPreset"
          >
            New Preset
          </NButton>
        </div>

        <div class="form-field">
          <label for="preset-name">Preset Name</label>
          <NInput
            id="preset-name"
            v-model:value="presetName"
            placeholder="My Sample Config"
            size="medium"
            data-testid="preset-name-input"
          />
        </div>

        <div class="form-field">
          <label>Prompts</label>
          <NDynamicInput
            v-model:value="prompts"
            :min="1"
            :on-create="createPromptItem"
            #="{ index, value }"
          >
            <div class="prompt-row">
              <NInput
                v-model:value="value.name"
                placeholder="Prompt name"
                size="medium"
                style="flex: 1;"
              />
              <NInput
                v-model:value="value.text"
                placeholder="Prompt text"
                size="medium"
                style="flex: 2;"
              />
            </div>
          </NDynamicInput>
        </div>

        <div class="form-field">
          <label for="negative-prompt">Negative Prompt</label>
          <NInput
            id="negative-prompt"
            v-model:value="negativePrompt"
            placeholder="low quality, blurry"
            type="textarea"
            size="medium"
            :rows="2"
            data-testid="negative-prompt-input"
          />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Steps</label>
            <NDynamicTags
              :value="stepsAsStrings"
              :input-props="numericInputProps"
              size="medium"
              data-testid="steps-tags"
              @update:value="onUpdateSteps"
            />
          </div>

          <div class="form-field">
            <label>CFG Values</label>
            <NDynamicTags
              :value="cfgsAsStrings"
              :input-props="numericInputProps"
              size="medium"
              data-testid="cfgs-tags"
              @update:value="onUpdateCfgs"
            />
          </div>
        </div>

        <div class="form-field">
          <label for="samplers">Samplers</label>
          <NSelect
            id="samplers"
            v-model:value="samplers"
            :options="samplerOptions"
            multiple
            filterable
            tag
            placeholder="Select or type samplers"
            size="medium"
            data-testid="samplers-select"
          />
        </div>

        <div class="form-field">
          <label for="schedulers">Schedulers</label>
          <NSelect
            id="schedulers"
            v-model:value="schedulers"
            :options="schedulerOptions"
            multiple
            filterable
            tag
            placeholder="Select or type schedulers"
            size="medium"
            data-testid="schedulers-select"
          />
        </div>

        <div class="form-field">
          <label>Seeds</label>
          <NDynamicTags
            :value="seedsAsStrings"
            :input-props="numericInputProps"
            size="medium"
            data-testid="seeds-tags"
            @update:value="onUpdateSeeds"
          />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label for="width">Width (px)</label>
            <NInputNumber
              id="width"
              v-model:value="width"
              :min="1"
              :step="64"
              size="medium"
              style="width: 100%;"
            />
          </div>

          <div class="form-field">
            <label for="height">Height (px)</label>
            <NInputNumber
              id="height"
              v-model:value="height"
              :min="1"
              :step="64"
              size="medium"
              style="width: 100%;"
            />
          </div>
        </div>

        <div class="total-images">
          <strong>Total images per checkpoint:</strong> {{ computedTotalImages }}
        </div>

        <div class="action-buttons">
          <NButton
            type="primary"
            size="medium"
            :disabled="!canSave || saving"
            :loading="saving"
            data-testid="save-preset-button"
            @click="savePreset"
          >
            {{ saving ? 'Saving...' : (selectedPresetId ? 'Update Preset' : 'Save Preset') }}
          </NButton>
          <NButton
            v-if="selectedPresetId"
            type="error"
            size="medium"
            data-testid="delete-preset-button"
            @click="deletePreset"
          >
            Delete Preset
          </NButton>
        </div>
      </NSpace>
    </NCard>
  </div>
</template>

<style scoped>
.sample-preset-editor {
  max-width: 800px;
  margin: 0 auto;
}

.preset-controls {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.preset-select {
  flex: 1;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.prompt-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.total-images {
  padding: 1rem;
  background: var(--accent-bg);
  border-radius: 0.25rem;
  text-align: center;
  font-size: 1.125rem;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-start;
}
</style>
