<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { NInput, NInputNumber, NSelect, NButton, NDynamicInput, NDynamicTags, NTag, NCard, NSpace, NAlert } from 'naive-ui'
import type { Study, NamedPrompt, SamplerSchedulerPair, LoraStrengthPair, ResolutionPair, CreateStudyPayload, UpdateStudyPayload, ForkStudyPayload, AffectedRun } from '../api/types'
import { apiClient } from '../api/client'
import { validateStudyImport } from './studyImportValidation'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue'
import StudyImmutabilityDialog from './StudyImmutabilityDialog.vue'
import { useStudyForm } from '../composables/useStudyForm'
import { useStudyOptions } from '../composables/useStudyOptions'
import { useStudyValidation } from '../composables/useStudyValidation'

// initialStudyId: When provided, the study with this ID is pre-selected after studies load.
// If null or the ID is not found in the loaded studies, no study is selected (default behavior).
const props = withDefaults(defineProps<{
  initialStudyId?: string | null
}>(), {
  initialStudyId: null,
})

// study-saved: Emitted after a study is created or updated. Payload: the saved Study.
// study-deleted: Emitted after a study is deleted. Payload: the deleted study's ID (string).
// study-regenerate: Emitted after user confirms regeneration of affected samplesets.
//   Payload: the updated Study and the list of affected training runs that need regeneration jobs.
const emit = defineEmits<{
  'study-saved': [study: Study]
  'study-deleted': [studyId: string]
  'study-regenerate': [study: Study, affectedRuns: AffectedRun[]]
}>()

const studies = ref<Study[]>([])
const selectedStudyId = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

/**
 * Disallowed characters for study name validation.
 * The backend is the authoritative source; this reactive ref is populated from the
 * backend API error response on the first rejected save, keeping the two in sync
 * without a maintained duplicate. The initial value is a bootstrap default that mirrors
 * the backend constant so inline validation works from the very first page load.
 */
const apiDisallowedChars = ref<string>(`()/\\:*?<>|"`)

/**
 * Parses the disallowed character set from a backend validation error message.
 * The backend message format is:
 *   "study name contains disallowed characters; the following characters are not allowed: XYZ"
 * Returns the character string (e.g. `()/\:*?<>|"`) or null if the message does not match.
 */
function extractDisallowedCharsFromMessage(message: string): string | null {
  const sentinel = 'the following characters are not allowed: '
  const idx = message.indexOf(sentinel)
  if (idx === -1) return null
  return message.slice(idx + sentinel.length)
}

/** Extracts a user-facing message from an unknown thrown value. */
function toErrorMessage(err: unknown, fallback: string): string {
  return err && typeof err === 'object' && 'message' in err
    ? String((err as { message: string }).message)
    : fallback
}

/**
 * Records a failed API call: surfaces the message and learns the backend's
 * disallowed character set from it when present, so future client-side
 * validation stays in sync without a maintained duplicate constant.
 */
function recordApiError(err: unknown, fallback: string): void {
  const message = toErrorMessage(err, fallback)
  error.value = message
  const parsed = extractDisallowedCharsFromMessage(message)
  if (parsed !== null) apiDisallowedChars.value = parsed
}

// Immutability dialog: shown when user edits a study that has generated samples.
// Offers three choices: Clone, Regenerate Existing, or Ignore.
const showImmutabilityDialog = ref(false)
/** Editable clone name pre-filled as "<study name> (copy)". */
const cloneName = ref('')
/** Affected runs loaded when the immutability dialog opens. */
const immutabilityAffectedRuns = ref<AffectedRun[]>([])
/** True while affected runs are loading for the immutability dialog. */
const loadingAffectedRuns = ref(false)

// Delete confirmation dialog
const showDeleteDialog = ref(false)

/**
 * Form state, MRU handling, and payload construction (R-021 extraction).
 * Declared before useStudyOptions so the options composable can watch
 * workflowTemplate, and before useStudyValidation which derives from these refs.
 */
const form = useStudyForm({
  // Role gating is resolved lazily: useStudyOptions is created below and needs
  // form.workflowTemplate, so these read through to it once both exist.
  hasVaeRole: computed(() => studyOptions.hasVaeRole.value),
  hasClipRole: computed(() => studyOptions.hasClipRole.value),
  hasShiftRole: computed(() => studyOptions.hasShiftRole.value),
})

const {
  studyName,
  promptPrefix,
  prompts,
  negativePrompt,
  steps,
  cfgs,
  samplerSchedulerPairs,
  loraStrengthPairs,
  seeds,
  resolutions,
  workflowTemplate,
  selectedVAEs,
  selectedTextEncoders,
  shifts,
} = form

/** ComfyUI / workflow option lists plus workflow role gating (R-021 extraction). */
const studyOptions = useStudyOptions({ workflowTemplate })

const {
  samplerOptions,
  schedulerOptions,
  workflowOptions,
  vaeOptions,
  clipOptions,
  hasShiftRole,
  hasVaeRole,
  hasClipRole,
} = studyOptions

/** Duplicate detection, save gating, and the total-image product (R-021 extraction). */
const {
  localValidationError,
  fieldValidationErrors,
  canSave,
  computedTotalImages,
} = useStudyValidation({
  studies,
  selectedStudyId,
  studyName,
  prompts,
  steps,
  cfgs,
  samplerSchedulerPairs,
  loraStrengthPairs,
  seeds,
  resolutions,
  selectedVAEs,
  selectedTextEncoders,
  shifts,
  apiDisallowedChars,
})

const selectOptions = computed(() =>
  studies.value.map((p) => ({
    label: p.name,
    value: p.id,
  }))
)

/** Shift values as strings for NDynamicTags. */
const shiftsAsStrings = computed(() => shifts.value.map(String))

function onUpdateShifts(tags: string[]) {
  shifts.value = tags.map(s => parseFloat(s)).filter(n => !isNaN(n))
}

function createResolutionItem(): ResolutionPair {
  return { width: 1024, height: 1024 }
}

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

onMounted(async () => {
  await Promise.all([
    fetchStudies(),
    studyOptions.fetchAll(),
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
    error.value = toErrorMessage(err, 'Failed to load studies')
  } finally {
    loading.value = false
  }
}

function onSelectStudy(value: string | null) {
  selectedStudyId.value = value
  if (!value) {
    form.resetForm()
    return
  }
  const study = studies.value.find(p => p.id === value)
  if (study) {
    form.loadStudy(study)
  }
}

function createNewStudy() {
  selectedStudyId.value = null
  form.resetForm()
}

async function saveStudy() {
  if (!canSave.value) return

  // When editing an existing study, check if it has generated samples
  if (selectedStudyId.value) {
    try {
      const { has_samples } = await apiClient.studyHasSamples(selectedStudyId.value)
      if (has_samples) {
        // Pre-fill clone name and load affected runs before showing the dialog
        cloneName.value = studyName.value.trim() + ' - copy'
        immutabilityAffectedRuns.value = []
        loadingAffectedRuns.value = true
        showImmutabilityDialog.value = true
        // Load affected runs in the background while dialog is visible
        try {
          immutabilityAffectedRuns.value = await apiClient.getAffectedRuns(selectedStudyId.value)
        } catch {
          immutabilityAffectedRuns.value = []
        } finally {
          loadingAffectedRuns.value = false
        }
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
    // Save workflow template and its dimension selections to MRU when set
    form.persistMru()

    const base = form.buildPayloadFields()
    const payload: CreateStudyPayload | UpdateStudyPayload = selectedStudyId.value
      ? { id: selectedStudyId.value, ...base }
      : base

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
    recordApiError(err, 'Failed to save study')
  } finally {
    saving.value = false
  }
}

/** Clone: create a new study from the current one using the user-editable clone name. */
async function cloneStudy() {
  if (!selectedStudyId.value || !canSave.value) return

  showImmutabilityDialog.value = false
  saving.value = true
  error.value = null
  try {
    // Save workflow template and its dimension selections to MRU when set
    form.persistMru()

    const forkPayload: ForkStudyPayload = {
      ...form.buildPayloadFields(),
      source_id: selectedStudyId.value,
      name: cloneName.value.trim(),
    }

    const result = await apiClient.forkStudy(forkPayload)

    // Add the new cloned study to the list and select it
    studies.value.push(result)
    selectedStudyId.value = result.id
    studyName.value = result.name
    emit('study-saved', result)
  } catch (err: unknown) {
    recordApiError(err, 'Failed to clone study')
  } finally {
    saving.value = false
  }
}

/** Regenerate Existing: update the study in-place, then emit study-regenerate
 *  with the affected runs that were already loaded when the dialog was opened. */
async function regenStudy() {
  // Capture affected runs before closing the dialog (they were pre-loaded)
  const affectedRuns = [...immutabilityAffectedRuns.value]
  showImmutabilityDialog.value = false
  await performSave()

  // After a successful save, emit study-regenerate with pre-loaded affected runs.
  // performSave sets error.value on failure, so only proceed when save succeeded.
  if (!error.value && selectedStudyId.value) {
    const saved = studies.value.find(s => s.id === selectedStudyId.value)
    if (saved) {
      emit('study-regenerate', saved, affectedRuns)
    }
  }
}

/** Ignore: update the study without touching samples. */
async function ignoreAndSave() {
  showImmutabilityDialog.value = false
  await performSave()
}

function deleteStudy() {
  if (!selectedStudyId.value) return
  showDeleteDialog.value = true
}

async function performDeleteStudy(deleteData: boolean) {
  if (!selectedStudyId.value) return

  error.value = null
  try {
    const deletedId = selectedStudyId.value
    await apiClient.deleteStudy(selectedStudyId.value, deleteData)
    studies.value = studies.value.filter(p => p.id !== selectedStudyId.value)
    form.resetForm()
    selectedStudyId.value = null
    emit('study-deleted', deletedId)
  } catch (err: unknown) {
    error.value = toErrorMessage(err, 'Failed to delete study')
  }
}

function exportStudy() {
  const payload: CreateStudyPayload = form.buildPayloadFields()
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
      // Populate form fields from imported data. An imported study with no prompts
      // is normalized to a single blank row so the form stays editable.
      form.loadStudy({
        ...result.data,
        prompts: result.data.prompts.length > 0 ? result.data.prompts : [{ name: '', text: '' }],
        workflow_template: result.data.workflow_template ?? null,
      })
      error.value = null
    } catch {
      error.value = 'Import error: Invalid JSON file'
    }
  }
  input.click()
}

/**
 * Called when the user selects (or clears) a workflow template via the NSelect.
 * Updates workflowTemplate and, when a workflow is chosen, auto-fills VAE and
 * text encoder from the stored MRU for that workflow (if any).
 *
 * This handler is NOT called during loadStudy / resetForm — those set the ref
 * value directly, bypassing the @update:value DOM event. So it is safe to apply
 * MRU here without a guard flag.
 */
function onWorkflowTemplateChange(name: string | null) {
  workflowTemplate.value = name
  form.applyMruForWorkflow(name)
}

function createPromptItem(): NamedPrompt {
  return { name: '', text: '' }
}

function createPairItem(): SamplerSchedulerPair {
  return { sampler: '', scheduler: '' }
}

function createLoraStrengthPairItem(): LoraStrengthPair {
  return { strength_model: 1.0, strength_clip: 1.0 }
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

/**
 * Render functions for NDynamicTags. Used via the :render-tag prop to apply
 * per-tag error highlighting (NTag type="error") for duplicate values.
 * NDynamicTags does not have a #tag slot; the renderTag prop is the only way
 * to customize individual tag rendering.
 */
function renderStepTag(tag: string, index: number) {
  const isError = fieldValidationErrors.value.stepIndices.has(index)
  return h(NTag, {
    closable: true,
    type: isError ? 'error' : 'default',
    size: 'medium',
    'data-testid': `step-tag-${index}`,
    onClose: () => {
      const updated = [...stepsAsStrings.value]
      updated.splice(index, 1)
      onUpdateSteps(updated)
    },
  }, () => tag)
}

function renderCfgTag(tag: string, index: number) {
  const isError = fieldValidationErrors.value.cfgIndices.has(index)
  return h(NTag, {
    closable: true,
    type: isError ? 'error' : 'default',
    size: 'medium',
    'data-testid': `cfg-tag-${index}`,
    onClose: () => {
      const updated = [...cfgsAsStrings.value]
      updated.splice(index, 1)
      onUpdateCfgs(updated)
    },
  }, () => tag)
}

function renderSeedTag(tag: string, index: number) {
  const isError = fieldValidationErrors.value.seedIndices.has(index)
  return h(NTag, {
    closable: true,
    type: isError ? 'error' : 'default',
    size: 'medium',
    'data-testid': `seed-tag-${index}`,
    onClose: () => {
      const updated = [...seedsAsStrings.value]
      updated.splice(index, 1)
      onUpdateSeeds(updated)
    },
  }, () => tag)
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
            :status="fieldValidationErrors.studyName ? 'error' : undefined"
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
            #="{ value, index }"
          >
            <div class="prompt-row" :class="{ 'field-error': fieldValidationErrors.promptIndices.has(index) }" :data-testid="`prompt-row-${index}`">
              <NInput
                v-model:value="value.name"
                placeholder="Prompt name"
                size="medium"
                :status="fieldValidationErrors.promptIndices.has(index) ? 'error' : undefined"
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
              :render-tag="renderStepTag"
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
              :render-tag="renderCfgTag"
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
              <div class="pair-row" :class="{ 'field-error': fieldValidationErrors.pairIndices.has(index) }" :data-testid="`pair-row-${index}`">
                <NSelect
                  :value="value.sampler"
                  :options="samplerOptions"
                  filterable
                  tag
                  placeholder="Sampler"
                  size="medium"
                  class="pair-select"
                  :status="fieldValidationErrors.pairIndices.has(index) ? 'error' : undefined"
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
                  :status="fieldValidationErrors.pairIndices.has(index) ? 'error' : undefined"
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
          <label>LoRA Strength Pairs</label>
          <div v-if="loraStrengthPairs.length > 0" class="pair-row-header" data-testid="lora-pair-header">
            <span class="pair-row-header-label">Model</span>
            <span class="pair-row-header-label">CLIP</span>
          </div>
          <NDynamicInput
            v-model:value="loraStrengthPairs"
            :min="0"
            :on-create="createLoraStrengthPairItem"
            :create-button-props="({ 'data-testid': 'lora-pairs-create-button' } as object)"
            data-testid="lora-strength-pairs"
          >
            <template #default="{ index, value }">
              <div class="pair-row" :class="{ 'field-error': fieldValidationErrors.loraPairIndices.has(index) }" :data-testid="`lora-pair-row-${index}`">
                <NInputNumber
                  :value="value.strength_model"
                  :min="0"
                  :max="2"
                  :step="0.05"
                  placeholder="Model"
                  size="medium"
                  style="flex: 1;"
                  :data-testid="`lora-pair-model-${index}`"
                  @update:value="(v: number | null) => { loraStrengthPairs[index].strength_model = v ?? 1.0 }"
                />
                <NInputNumber
                  :value="value.strength_clip"
                  :min="0"
                  :max="2"
                  :step="0.05"
                  placeholder="CLIP"
                  size="medium"
                  style="flex: 1;"
                  :data-testid="`lora-pair-clip-${index}`"
                  @update:value="(v: number | null) => { loraStrengthPairs[index].strength_clip = v ?? 1.0 }"
                />
              </div>
            </template>
            <template #action="{ index: actionIndex, create, remove }">
              <div class="pair-row-actions">
                <NButton
                  circle
                  size="small"
                  :data-testid="`lora-pair-row-remove-${actionIndex}`"
                  @click="remove(actionIndex)"
                >
                  -
                </NButton>
                <NButton
                  circle
                  size="small"
                  :data-testid="`lora-pair-row-add-${actionIndex}`"
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
            :render-tag="renderSeedTag"
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

        <div class="form-field">
          <label>Resolutions (width × height)</label>
          <NDynamicInput
            v-model:value="resolutions"
            :min="1"
            :on-create="createResolutionItem"
            :create-button-props="({ 'data-testid': 'resolutions-create-button' } as object)"
            data-testid="resolutions-list"
          >
            <template #default="{ index, value }">
              <div class="pair-row" :data-testid="`resolution-row-${index}`">
                <NInputNumber
                  :value="value.width"
                  :min="1"
                  :step="64"
                  placeholder="Width"
                  size="medium"
                  style="flex: 1;"
                  :data-testid="`resolution-width-${index}`"
                  @update:value="(v: number | null) => { resolutions[index].width = v ?? 1 }"
                />
                <NInputNumber
                  :value="value.height"
                  :min="1"
                  :step="64"
                  placeholder="Height"
                  size="medium"
                  style="flex: 1;"
                  :data-testid="`resolution-height-${index}`"
                  @update:value="(v: number | null) => { resolutions[index].height = v ?? 1 }"
                />
              </div>
            </template>
            <template #action="{ index: actionIndex, create, remove }">
              <div class="pair-row-actions">
                <NButton
                  circle
                  size="small"
                  :data-testid="`resolution-row-remove-${actionIndex}`"
                  @click="remove(actionIndex)"
                >
                  -
                </NButton>
                <NButton
                  circle
                  size="small"
                  :data-testid="`resolution-row-add-${actionIndex}`"
                  @click="create(actionIndex)"
                >
                  +
                </NButton>
              </div>
            </template>
          </NDynamicInput>
        </div>

        <div class="form-field">
          <label for="workflow-template-select">Workflow Template</label>
          <NSelect
            id="workflow-template-select"
            :value="workflowTemplate"
            :options="workflowOptions"
            placeholder="Select a workflow template (optional)"
            clearable
            filterable
            data-testid="study-workflow-template-select"
            @update:value="onWorkflowTemplateChange"
          />
        </div>

        <div v-if="hasVaeRole" class="form-field">
          <label for="study-vae-select">VAEs</label>
          <NSelect
            id="study-vae-select"
            v-model:value="selectedVAEs"
            :options="vaeOptions"
            multiple
            placeholder="Select one or more VAE models (optional)"
            clearable
            filterable
            data-testid="study-vae-select"
          />
        </div>

        <div v-if="hasClipRole" class="form-field">
          <label for="study-clip-select">CLIP / Text Encoders</label>
          <NSelect
            id="study-clip-select"
            v-model:value="selectedTextEncoders"
            :options="clipOptions"
            multiple
            placeholder="Select one or more CLIP models (optional)"
            clearable
            filterable
            data-testid="study-clip-select"
          />
        </div>

        <div v-if="hasShiftRole" class="form-field">
          <label>Shift Values</label>
          <NDynamicTags
            :value="shiftsAsStrings"
            :input-props="numericInputProps"
            size="medium"
            data-testid="study-shift-input"
            @update:value="onUpdateShifts"
          >
            <template #trigger="{ activate, disabled }">
              <NButton
                size="medium"
                dashed
                :disabled="disabled"
                data-testid="study-shift-add"
                @click="activate"
              >
                +
              </NButton>
            </template>
          </NDynamicTags>
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

    <!-- Delete confirmation dialog -->
    <ConfirmDeleteDialog
      v-model:show="showDeleteDialog"
      title="Delete Study"
      :description="`Are you sure you want to delete the study &quot;${studyName}&quot;? This action cannot be undone.`"
      checkbox-label="Also delete sample data"
      :checkbox-checked="false"
      data-testid="delete-study-dialog"
      @confirm="performDeleteStudy"
    />

    <StudyImmutabilityDialog
      v-model:show="showImmutabilityDialog"
      v-model:clone-name="cloneName"
      :affected-runs="immutabilityAffectedRuns"
      :loading-affected-runs="loadingAffectedRuns"
      @clone="cloneStudy"
      @regenerate="regenStudy"
      @ignore="ignoreAndSave"
    />
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

.pair-row-header {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.pair-row-header-label {
  flex: 1;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
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

/* Field-level validation error highlight: applied to prompt-row and pair-row containers */
.field-error {
  border: 1px solid var(--error-color);
  border-radius: 0.25rem;
  padding: 0.25rem;
}

/* Immutability dialog option layout now lives in StudyImmutabilityDialog.vue */
</style>
