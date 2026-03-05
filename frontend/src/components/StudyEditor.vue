<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput, NInputNumber, NSelect, NButton, NDynamicInput, NDynamicTags, NCard, NSpace, NAlert, NModal } from 'naive-ui'
import type { Study, NamedPrompt, SamplerSchedulerPair, CreateStudyPayload, UpdateStudyPayload, ForkStudyPayload } from '../api/types'
import { apiClient } from '../api/client'
import { validateStudyImport } from './studyImportValidation'

// initialStudyId: When provided, the study with this ID is pre-selected after studies load.
// If null or the ID is not found in the loaded studies, no study is selected (default behavior).
const props = withDefaults(defineProps<{
  initialStudyId?: string | null
}>(), {
  initialStudyId: null,
})

// study-saved: Emitted after a study is created or updated. Payload: the saved Study.
// study-deleted: Emitted after a study is deleted. Payload: the deleted study's ID (string).
const emit = defineEmits<{
  'study-saved': [study: Study]
  'study-deleted': [studyId: string]
}>()

const studies = ref<Study[]>([])
const selectedStudyId = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

// Immutability dialog: shown when user edits a study that has generated samples
const showImmutabilityDialog = ref(false)

// Form fields
const studyName = ref('')
const promptPrefix = ref('')
const prompts = ref<NamedPrompt[]>([{ name: '', text: '' }])
const negativePrompt = ref('')
const steps = ref<number[]>([30])
const cfgs = ref<number[]>([7.0])
const samplerSchedulerPairs = ref<SamplerSchedulerPair[]>([])
const seeds = ref<number[]>([42])
const width = ref(1024)
const height = ref(1024)

// Available options from ComfyUI
const availableSamplers = ref<string[]>([])
const availableSchedulers = ref<string[]>([])

const selectOptions = computed(() =>
  studies.value.map((p) => ({
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

/**
 * Format a CFG value as a string, preserving one decimal place for whole numbers.
 * e.g. 7.0 → '7.0', 7.5 → '7.5', 12 → '12.0'
 * This matches the floating-point format defined in DEVELOPMENT_PRACTICES section 4.11.
 */
function formatCfg(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n)
}

// String representations for NDynamicTags
const stepsAsStrings = computed(() => steps.value.map(String))
const cfgsAsStrings = computed(() => cfgs.value.map(formatCfg))
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
    samplerSchedulerPairs.value.length *
    seeds.value.length
  )
})

/**
 * Returns a validation error message if any dimension field contains duplicates,
 * or if the study name already exists in the loaded studies list.
 * Returns null when no validation issues are found.
 */
const localValidationError = computed((): string | null => {
  // Check for duplicate prompt names (slugs)
  const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')
  const promptNames = validPrompts.map(p => p.name.trim())
  const seenPromptNames = new Set<string>()
  for (const name of promptNames) {
    if (seenPromptNames.has(name)) {
      return `Duplicate prompt name: "${name}"`
    }
    seenPromptNames.add(name)
  }

  // Check for duplicate steps
  const seenSteps = new Set<number>()
  for (const step of steps.value) {
    if (seenSteps.has(step)) {
      return `Duplicate step value: ${step}`
    }
    seenSteps.add(step)
  }

  // Check for duplicate CFG values
  const seenCfgs = new Set<number>()
  for (const cfg of cfgs.value) {
    if (seenCfgs.has(cfg)) {
      return `Duplicate CFG value: ${cfg}`
    }
    seenCfgs.add(cfg)
  }

  // Check for duplicate sampler/scheduler pairs
  const seenPairs = new Set<string>()
  for (const pair of samplerSchedulerPairs.value) {
    const key = `${pair.sampler}/${pair.scheduler}`
    if (seenPairs.has(key)) {
      return `Duplicate sampler/scheduler pair: ${pair.sampler} / ${pair.scheduler}`
    }
    seenPairs.add(key)
  }

  // Check for duplicate seeds
  const seenSeeds = new Set<number>()
  for (const seed of seeds.value) {
    if (seenSeeds.has(seed)) {
      return `Duplicate seed value: ${seed}`
    }
    seenSeeds.add(seed)
  }

  // Check for duplicate study name against the loaded studies list,
  // excluding the currently selected study (when editing).
  const trimmedName = studyName.value.trim()
  if (trimmedName !== '') {
    const conflict = studies.value.find(
      s => s.name === trimmedName && s.id !== selectedStudyId.value
    )
    if (conflict) {
      return `A study named "${trimmedName}" already exists`
    }
  }

  return null
})

const canSave = computed(() => {
  return (
    studyName.value.trim() !== '' &&
    prompts.value.some(p => p != null && p.name.trim() !== '' && p.text.trim() !== '') &&
    steps.value.length > 0 &&
    cfgs.value.length > 0 &&
    samplerSchedulerPairs.value.length > 0 &&
    samplerSchedulerPairs.value.every(p => p.sampler.trim() !== '' && p.scheduler.trim() !== '') &&
    seeds.value.length > 0 &&
    width.value > 0 &&
    height.value > 0 &&
    localValidationError.value === null
  )
})

onMounted(async () => {
  await Promise.all([
    fetchStudies(),
    fetchSamplers(),
    fetchSchedulers(),
  ])

  // After studies are loaded, pre-select the study from the parent dialog if one was provided.
  if (props.initialStudyId !== null) {
    const match = studies.value.find(p => p.id === props.initialStudyId)
    if (match) {
      onSelectStudy(match.id)
    }
  }
})

async function fetchStudies() {
  loading.value = true
  error.value = null
  try {
    studies.value = await apiClient.listStudies()
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to load studies'
    error.value = message
  } finally {
    loading.value = false
  }
}

async function fetchSamplers() {
  try {
    const result = await apiClient.getComfyUIModels('sampler')
    availableSamplers.value = result.models
  } catch {
    // Silently fail - ComfyUI might not be available
    availableSamplers.value = []
  }
}

async function fetchSchedulers() {
  try {
    const result = await apiClient.getComfyUIModels('scheduler')
    availableSchedulers.value = result.models
  } catch {
    // Silently fail - ComfyUI might not be available
    availableSchedulers.value = []
  }
}

function onSelectStudy(value: string | null) {
  selectedStudyId.value = value
  if (!value) {
    resetForm()
    return
  }
  const study = studies.value.find(p => p.id === value)
  if (study) {
    loadStudy(study)
  }
}

function loadStudy(study: Study) {
  studyName.value = study.name
  promptPrefix.value = study.prompt_prefix
  prompts.value = [...study.prompts]
  negativePrompt.value = study.negative_prompt
  steps.value = [...study.steps]
  cfgs.value = [...study.cfgs]
  samplerSchedulerPairs.value = study.sampler_scheduler_pairs.map(p => ({ ...p }))
  seeds.value = [...study.seeds]
  width.value = study.width
  height.value = study.height
}

function resetForm() {
  studyName.value = ''
  promptPrefix.value = ''
  prompts.value = [{ name: '', text: '' }]
  negativePrompt.value = ''
  steps.value = [30]
  cfgs.value = [7.0]
  samplerSchedulerPairs.value = []
  seeds.value = [42]
  width.value = 1024
  height.value = 1024
}

function createNewStudy() {
  selectedStudyId.value = null
  resetForm()
}

async function saveStudy() {
  if (!canSave.value) return

  // When editing an existing study, check if it has generated samples
  if (selectedStudyId.value) {
    try {
      const { has_samples } = await apiClient.studyHasSamples(selectedStudyId.value)
      if (has_samples) {
        // Show immutability dialog instead of saving directly
        showImmutabilityDialog.value = true
        return
      }
    } catch {
      // If the check fails, fall through to allow the save
    }
  }

  await performSave()
}

/** Actually perform the save (create or update). Called directly or after immutability dialog choice. */
async function performSave() {
  if (!canSave.value) return

  saving.value = true
  error.value = null
  try {
    // Filter out empty prompts
    const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')

    const payload: CreateStudyPayload | UpdateStudyPayload = selectedStudyId.value
      ? {
          id: selectedStudyId.value,
          name: studyName.value.trim(),
          prompt_prefix: promptPrefix.value,
          prompts: validPrompts,
          negative_prompt: negativePrompt.value,
          steps: steps.value,
          cfgs: cfgs.value,
          sampler_scheduler_pairs: samplerSchedulerPairs.value,
          seeds: seeds.value,
          width: width.value,
          height: height.value,
        }
      : {
          name: studyName.value.trim(),
          prompt_prefix: promptPrefix.value,
          prompts: validPrompts,
          negative_prompt: negativePrompt.value,
          steps: steps.value,
          cfgs: cfgs.value,
          sampler_scheduler_pairs: samplerSchedulerPairs.value,
          seeds: seeds.value,
          width: width.value,
          height: height.value,
        }

    const result = selectedStudyId.value
      ? await apiClient.updateStudy(payload as UpdateStudyPayload)
      : await apiClient.createStudy(payload as CreateStudyPayload)

    // Update studies list
    if (selectedStudyId.value) {
      const index = studies.value.findIndex(p => p.id === selectedStudyId.value)
      if (index !== -1) {
        studies.value[index] = result
      }
    } else {
      studies.value.push(result)
      selectedStudyId.value = result.id
    }
    emit('study-saved', result)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to save study'
    error.value = message
  } finally {
    saving.value = false
  }
}

/** Fork: create a new study from the current one with the modified settings. */
async function forkStudy() {
  if (!selectedStudyId.value || !canSave.value) return

  showImmutabilityDialog.value = false
  saving.value = true
  error.value = null
  try {
    const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')
    const forkPayload: ForkStudyPayload = {
      source_id: selectedStudyId.value,
      name: studyName.value.trim() + ' (copy)',
      prompt_prefix: promptPrefix.value,
      prompts: validPrompts,
      negative_prompt: negativePrompt.value,
      steps: steps.value,
      cfgs: cfgs.value,
      sampler_scheduler_pairs: samplerSchedulerPairs.value,
      seeds: seeds.value,
      width: width.value,
      height: height.value,
    }

    const result = await apiClient.forkStudy(forkPayload)

    // Add the new forked study to the list and select it
    studies.value.push(result)
    selectedStudyId.value = result.id
    studyName.value = result.name
    emit('study-saved', result)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to fork study'
    error.value = message
  } finally {
    saving.value = false
  }
}

/** Re-generate: update the study in-place (samples will need to be regenerated). */
async function regenStudy() {
  showImmutabilityDialog.value = false
  await performSave()
}

function cancelImmutabilityDialog() {
  showImmutabilityDialog.value = false
}

async function deleteStudy() {
  if (!selectedStudyId.value) return

  const confirmed = confirm(`Delete study "${studyName.value}"?`)
  if (!confirmed) return

  error.value = null
  try {
    const deletedId = selectedStudyId.value
    await apiClient.deleteStudy(selectedStudyId.value)
    studies.value = studies.value.filter(p => p.id !== selectedStudyId.value)
    resetForm()
    selectedStudyId.value = null
    emit('study-deleted', deletedId)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to delete study'
    error.value = message
  }
}

function exportStudy() {
  const payload: CreateStudyPayload = {
    name: studyName.value.trim(),
    prompt_prefix: promptPrefix.value,
    prompts: prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== ''),
    negative_prompt: negativePrompt.value,
    steps: steps.value,
    cfgs: cfgs.value,
    sampler_scheduler_pairs: samplerSchedulerPairs.value,
    seeds: seeds.value,
    width: width.value,
    height: height.value,
  }
  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const filename = (studyName.value.trim() || 'study').replace(/[^a-z0-9_\-. ]/gi, '_') + '.json'
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const result = validateStudyImport(raw)
      if (!result.ok) {
        error.value = `Import error: ${result.error}`
        return
      }
      // Deselect any existing study so this creates a new one
      selectedStudyId.value = null
      // Populate form fields from imported data
      studyName.value = result.data.name
      promptPrefix.value = result.data.prompt_prefix
      prompts.value = result.data.prompts.length > 0 ? [...result.data.prompts] : [{ name: '', text: '' }]
      negativePrompt.value = result.data.negative_prompt
      steps.value = [...result.data.steps]
      cfgs.value = [...result.data.cfgs]
      samplerSchedulerPairs.value = result.data.sampler_scheduler_pairs.map(p => ({ ...p }))
      seeds.value = [...result.data.seeds]
      width.value = result.data.width
      height.value = result.data.height
      error.value = null
    } catch {
      error.value = 'Import error: Invalid JSON file'
    }
  }
  input.click()
}

function createPromptItem(): NamedPrompt {
  return { name: '', text: '' }
}

function createPairItem(): SamplerSchedulerPair {
  return { sampler: '', scheduler: '' }
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
  <div class="study-editor">
    <NCard title="Study Editor">
      <NSpace vertical :size="16">
        <NAlert v-if="error" type="error" closable @close="error = null">
          {{ error }}
        </NAlert>
        <NAlert v-if="localValidationError" type="warning" data-testid="local-validation-error">
          {{ localValidationError }}
        </NAlert>

        <div class="study-controls">
          <NSelect
            :value="selectedStudyId"
            :options="selectOptions"
            :disabled="loading"
            :placeholder="loading ? 'Loading...' : 'Select a study'"
            :loading="loading"
            clearable
            class="study-select"
            size="medium"
            data-testid="study-editor-select"
            @update:value="onSelectStudy"
          />
          <NButton
            size="medium"
            data-testid="new-study-button"
            @click="createNewStudy"
          >
            New Study
          </NButton>
        </div>

        <div class="form-field">
          <label for="study-name">Study Name</label>
          <NInput
            id="study-name"
            v-model:value="studyName"
            placeholder="My Study Config"
            size="medium"
            data-testid="study-name-input"
          />
        </div>

        <div class="form-field">
          <label for="prompt-prefix">Prompt Prefix</label>
          <NInput
            id="prompt-prefix"
            v-model:value="promptPrefix"
            placeholder="Text prepended to each prompt (e.g. 'photo of a person, ')"
            size="medium"
            data-testid="prompt-prefix-input"
          />
        </div>

        <div class="form-field">
          <label>Prompts</label>
          <NDynamicInput
            v-model:value="prompts"
            :min="1"
            :on-create="createPromptItem"
            #="{ value }"
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
            >
              <template #trigger="{ activate, disabled }">
                <NButton
                  size="medium"
                  dashed
                  :disabled="disabled"
                  data-testid="steps-tags-add"
                  @click="activate"
                >
                  +
                </NButton>
              </template>
            </NDynamicTags>
          </div>

          <div class="form-field">
            <label>CFG Values</label>
            <NDynamicTags
              :value="cfgsAsStrings"
              :input-props="numericInputProps"
              size="medium"
              data-testid="cfgs-tags"
              @update:value="onUpdateCfgs"
            >
              <template #trigger="{ activate, disabled }">
                <NButton
                  size="medium"
                  dashed
                  :disabled="disabled"
                  data-testid="cfgs-tags-add"
                  @click="activate"
                >
                  +
                </NButton>
              </template>
            </NDynamicTags>
          </div>
        </div>

        <div class="form-field">
          <label>Sampler / Scheduler Pairs</label>
          <NDynamicInput
            v-model:value="samplerSchedulerPairs"
            :min="0"
            :on-create="createPairItem"
            :create-button-props="({ 'data-testid': 'pairs-create-button' } as object)"
            data-testid="sampler-scheduler-pairs"
          >
            <template #default="{ index, value }">
              <div class="pair-row">
                <NSelect
                  :value="value.sampler"
                  :options="samplerOptions"
                  filterable
                  tag
                  placeholder="Sampler"
                  size="medium"
                  class="pair-select"
                  :data-testid="`pair-sampler-${index}`"
                  @update:value="(v: string) => { samplerSchedulerPairs[index].sampler = v }"
                />
                <NSelect
                  :value="value.scheduler"
                  :options="schedulerOptions"
                  filterable
                  tag
                  placeholder="Scheduler"
                  size="medium"
                  class="pair-select"
                  :data-testid="`pair-scheduler-${index}`"
                  @update:value="(v: string) => { samplerSchedulerPairs[index].scheduler = v }"
                />
              </div>
            </template>
            <template #action="{ index: actionIndex, create, remove }">
              <div class="pair-row-actions">
                <NButton
                  circle
                  size="small"
                  :data-testid="`pair-row-remove-${actionIndex}`"
                  @click="remove(actionIndex)"
                >
                  -
                </NButton>
                <NButton
                  circle
                  size="small"
                  :data-testid="`pair-row-add-${actionIndex}`"
                  @click="create(actionIndex)"
                >
                  +
                </NButton>
              </div>
            </template>
          </NDynamicInput>
        </div>

        <div class="form-field">
          <label>Seeds</label>
          <NDynamicTags
            :value="seedsAsStrings"
            :input-props="numericInputProps"
            size="medium"
            data-testid="seeds-tags"
            @update:value="onUpdateSeeds"
          >
            <template #trigger="{ activate, disabled }">
              <NButton
                size="medium"
                dashed
                :disabled="disabled"
                data-testid="seeds-tags-add"
                @click="activate"
              >
                +
              </NButton>
            </template>
          </NDynamicTags>
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
            data-testid="save-study-button"
            @click="saveStudy"
          >
            {{ saving ? 'Saving...' : (selectedStudyId ? 'Update Study' : 'Save Study') }}
          </NButton>
          <NButton
            v-if="selectedStudyId"
            type="error"
            size="medium"
            data-testid="delete-study-button"
            @click="deleteStudy"
          >
            Delete Study
          </NButton>
          <NButton
            size="medium"
            :disabled="!canSave"
            data-testid="export-study-button"
            @click="exportStudy"
          >
            Export
          </NButton>
          <NButton
            size="medium"
            data-testid="import-study-button"
            @click="triggerImport"
          >
            Import
          </NButton>
        </div>
      </NSpace>
    </NCard>

    <!-- Immutability dialog: shown when user edits a study that has generated samples -->
    <NModal
      v-model:show="showImmutabilityDialog"
      preset="dialog"
      title="Study Has Generated Samples"
      :closable="true"
      data-testid="immutability-dialog"
    >
      <p>
        This study already has generated samples on disk. Changing its configuration
        will invalidate those samples. Choose how to proceed:
      </p>
      <NSpace vertical :size="12" style="margin-top: 1rem;">
        <NButton
          type="primary"
          block
          data-testid="immutability-fork-button"
          @click="forkStudy"
        >
          Create New Study (Fork)
        </NButton>
        <NButton
          type="warning"
          block
          data-testid="immutability-regen-button"
          @click="regenStudy"
        >
          Re-generate Samples (Update In-Place)
        </NButton>
        <NButton
          block
          data-testid="immutability-cancel-button"
          @click="cancelImmutabilityDialog"
        >
          Cancel
        </NButton>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.study-editor {
  max-width: 800px;
  margin: 0 auto;
}

.study-controls {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.study-select {
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

.pair-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.pair-select {
  flex: 1;
}

.pair-row-actions {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  margin-left: 0.5rem;
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
