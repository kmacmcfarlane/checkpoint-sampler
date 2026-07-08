<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { NInput, NInputNumber, NSelect, NButton, NDynamicInput, NDynamicTags, NTag, NCard, NSpace, NAlert, NModal } from 'naive-ui'
import type { Study, NamedPrompt, SamplerSchedulerPair, LoraStrengthPair, ResolutionPair, CreateStudyPayload, UpdateStudyPayload, ForkStudyPayload, WorkflowSummary, AffectedRun } from '../api/types'
import { apiClient } from '../api/client'
import { validateStudyImport } from './studyImportValidation'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue'

/** localStorage key for most-recently-used workflow template. */
const MRU_WORKFLOW_KEY = 'checkpoint-sampler:mru-workflow-template'

/**
 * localStorage key for most-recently-used VAE, text encoder, and shift per workflow template.
 * S-157: these are now multi-value dimensions, stored as arrays. Reads tolerate the
 * legacy single-value shape ({ vae, textEncoder, shift }) by wrapping in arrays.
 * Stored as a JSON-serialised map:
 *   Record<workflowName, { vaes: string[], textEncoders: string[], shifts: number[] }>.
 */
const MRU_WORKFLOW_VAE_TE_KEY = 'checkpoint-sampler:mru-workflow-vae-te'

/** Multi-value MRU shape for VAE / text-encoder / shift dimensions (S-157). */
interface MruDimensions {
  vaes: string[]
  textEncoders: string[]
  shifts: number[]
}

/**
 * localStorage key for most-recently-used sampler/scheduler pairs per workflow template.
 * Stored as a JSON-serialised map: Record<workflowName, Array<{ sampler: string, scheduler: string }>>.
 */
const MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY = 'checkpoint-sampler:mru-workflow-sampler-scheduler'

function getMruWorkflow(): string | null {
  try { return localStorage.getItem(MRU_WORKFLOW_KEY) } catch { return null }
}

function saveMruWorkflow(name: string | null): void {
  try {
    if (name) localStorage.setItem(MRU_WORKFLOW_KEY, name)
    else localStorage.removeItem(MRU_WORKFLOW_KEY)
  } catch { /* ignore */ }
}

/** Returns the raw MRU VAE/text-encoder/shift map from localStorage. */
function getMruVaeTe(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(MRU_WORKFLOW_VAE_TE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
    return {}
  } catch { return {} }
}

/**
 * Normalizes a stored MRU entry into the multi-value shape, tolerating the legacy
 * single-value shape ({ vae, textEncoder, shift }) written before S-157.
 */
function normalizeMruEntry(entry: unknown): MruDimensions | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (Array.isArray(e.vaes) || Array.isArray(e.textEncoders) || Array.isArray(e.shifts)) {
    return {
      vaes: Array.isArray(e.vaes) ? (e.vaes as string[]) : [],
      textEncoders: Array.isArray(e.textEncoders) ? (e.textEncoders as string[]) : [],
      shifts: Array.isArray(e.shifts) ? (e.shifts as number[]) : [],
    }
  }
  // Legacy single-value shape.
  return {
    vaes: typeof e.vae === 'string' && e.vae ? [e.vae] : [],
    textEncoders: typeof e.textEncoder === 'string' && e.textEncoder ? [e.textEncoder] : [],
    shifts: typeof e.shift === 'number' ? [e.shift] : [],
  }
}

/** Returns the MRU dimensions for a given workflow name, or null if not stored. */
function getMruVaeTeForWorkflow(workflowName: string): MruDimensions | null {
  const map = getMruVaeTe()
  return normalizeMruEntry(map[workflowName])
}

/** Saves the MRU VAE, text encoder, and shift lists for a given workflow name (S-157). */
function saveMruVaeTe(workflowName: string, vaes: string[], textEncoders: string[], shifts: number[]): void {
  try {
    const map = getMruVaeTe()
    map[workflowName] = { vaes, textEncoders, shifts }
    localStorage.setItem(MRU_WORKFLOW_VAE_TE_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

/** Returns the MRU sampler/scheduler pairs map from localStorage. */
function getMruSamplerScheduler(): Record<string, Array<{ sampler: string; scheduler: string }>> {
  try {
    const raw = localStorage.getItem(MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, Array<{ sampler: string; scheduler: string }>>
    return {}
  } catch { return {} }
}

/** Returns the MRU sampler/scheduler pairs for a given workflow name, or null if not stored. */
function getMruSamplerSchedulerForWorkflow(workflowName: string): Array<{ sampler: string; scheduler: string }> | null {
  const map = getMruSamplerScheduler()
  return map[workflowName] ?? null
}

/** Saves the MRU sampler/scheduler pairs for a given workflow name. */
function saveMruSamplerScheduler(workflowName: string, pairs: Array<{ sampler: string; scheduler: string }>): void {
  try {
    const map = getMruSamplerScheduler()
    map[workflowName] = pairs
    localStorage.setItem(MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

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

// Form fields
const studyName = ref('')
const promptPrefix = ref('')
const prompts = ref<NamedPrompt[]>([{ name: '', text: '' }])
const negativePrompt = ref('')
const steps = ref<number[]>([30])
const cfgs = ref<number[]>([7.0])
const samplerSchedulerPairs = ref<SamplerSchedulerPair[]>([])
const loraStrengthPairs = ref<LoraStrengthPair[]>([{ strength_model: 1.0, strength_clip: 1.0 }])
const seeds = ref<number[]>([42])
// S-157: resolution is a paired multi-value dimension (mirrors LoRA strength pairs).
const resolutions = ref<ResolutionPair[]>([{ width: 1024, height: 1024 }])
const workflowTemplate = ref<string | null>(null)
// S-157: VAE / text-encoder / shift are multi-value dimensions gated by workflow roles.
const selectedVAEs = ref<string[]>([])
const selectedTextEncoders = ref<string[]>([])
const shifts = ref<number[]>([])

/**
 * Static fallback sampler list for when ComfyUI is unavailable or returns no options.
 * Covers the standard KSampler options shipped with ComfyUI.
 */
const FALLBACK_SAMPLERS: string[] = [
  'euler',
  'euler_cfg_pp',
  'euler_ancestral',
  'euler_ancestral_cfg_pp',
  'heun',
  'heunpp2',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpm_fast',
  'dpm_adaptive',
  'dpmpp_2s_ancestral',
  'dpmpp_sde',
  'dpmpp_sde_gpu',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_2m_sde_gpu',
  'dpmpp_3m_sde',
  'dpmpp_3m_sde_gpu',
  'ddpm',
  'lcm',
  'ipndm',
  'ipndm_v',
  'deis',
  'ddim',
  'uni_pc',
  'uni_pc_bh2',
]

/**
 * Static fallback scheduler list for when ComfyUI is unavailable or returns no options.
 * Covers the standard KSampler schedulers shipped with ComfyUI.
 */
const FALLBACK_SCHEDULERS: string[] = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
]

// Available options from ComfyUI
const availableSamplers = ref<string[]>([])
const availableSchedulers = ref<string[]>([])
const availableWorkflows = ref<WorkflowSummary[]>([])
const availableVAE = ref<string[]>([])
const availableCLIP = ref<string[]>([])

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

const workflowOptions = computed(() =>
  availableWorkflows.value
    .filter(w => w.validation_state === 'valid')
    .map(w => ({ label: w.name, value: w.name }))
)

const vaeOptions = computed(() =>
  availableVAE.value.map(v => ({ label: v, value: v }))
)

const clipOptions = computed(() =>
  availableCLIP.value.map(c => ({ label: c, value: c }))
)

const selectedWorkflowDetail = computed(() =>
  availableWorkflows.value.find(w => w.name === workflowTemplate.value)
)

const hasShiftRole = computed(() => {
  const wf = selectedWorkflowDetail.value
  if (!wf) return false
  return 'shift' in wf.roles
})

// S-157: VAE and text-encoder dimensions are only offered when the selected
// workflow declares the matching role.
const hasVaeRole = computed(() => {
  const wf = selectedWorkflowDetail.value
  if (!wf) return false
  return 'vae_loader' in wf.roles
})

const hasClipRole = computed(() => {
  const wf = selectedWorkflowDetail.value
  if (!wf) return false
  return 'clip_loader' in wf.roles
})

/**
 * Role-gated payload values for the VAE/text-encoder/shift dimensions.
 *
 * The form keeps whatever values the user entered in selectedVAEs/
 * selectedTextEncoders/shifts even after switching to a workflow that does not
 * declare the matching role (there is no watcher clearing them — the input is
 * simply hidden via v-if). Without gating here, stale values from a previous
 * role-bearing workflow would be persisted and silently multiply the
 * cross-product / surface a spurious dimension for a workflow that never
 * declared the role. These computeds are the single place that enforces "empty
 * for a role the workflow does not declare" before building any payload.
 */
const payloadVAEs = computed(() => (hasVaeRole.value ? selectedVAEs.value : []))
const payloadTextEncoders = computed(() => (hasClipRole.value ? selectedTextEncoders.value : []))
const payloadShifts = computed(() => (hasShiftRole.value ? shifts.value : []))

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

const computedTotalImages = computed(() => {
  const validPrompts = prompts.value.filter(p => p != null && p.name && p.text)
  const base =
    validPrompts.length *
    steps.value.length *
    cfgs.value.length *
    samplerSchedulerPairs.value.length *
    seeds.value.length
  // LoRA strength pairs add an extra dimension to the Cartesian product
  const loraPairCount = loraStrengthPairs.value.length
  let total = loraPairCount > 0 ? base * loraPairCount : base
  // S-157: multiply by each non-empty promoted dimension (empty = factor of 1).
  const mult = (n: number) => (n > 0 ? n : 1)
  total *= mult(resolutions.value.length)
  total *= mult(selectedVAEs.value.length)
  total *= mult(selectedTextEncoders.value.length)
  total *= mult(shifts.value.length)
  return total
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

  // Check for duplicate LoRA strength pairs
  const seenLoraPairs = new Set<string>()
  for (const pair of loraStrengthPairs.value) {
    const key = `${pair.strength_model}/${pair.strength_clip}`
    if (seenLoraPairs.has(key)) {
      return `Duplicate LoRA strength pair: model=${pair.strength_model}, clip=${pair.strength_clip}`
    }
    seenLoraPairs.add(key)
  }

  // Check for duplicate seeds
  const seenSeeds = new Set<number>()
  for (const seed of seeds.value) {
    if (seenSeeds.has(seed)) {
      return `Duplicate seed value: ${seed}`
    }
    seenSeeds.add(seed)
  }

  // Check study name for filesystem-unsafe characters.
  // apiDisallowedChars starts with a bootstrap default and is updated from the backend
  // error response on the first rejected save, keeping the set authoritative without a
  // maintained duplicate constant.
  const studyNameVal = studyName.value.trim()
  if (studyNameVal !== '') {
    for (const ch of apiDisallowedChars.value) {
      if (studyNameVal.includes(ch)) {
        return `Study name contains disallowed characters; the following characters are not allowed: ${apiDisallowedChars.value}`
      }
    }
  }

  // Check for duplicate study name against the loaded studies list,
  // excluding the currently selected study (when editing).
  if (studyNameVal !== '') {
    const conflict = studies.value.find(
      s => s.name === studyNameVal && s.id !== selectedStudyId.value
    )
    if (conflict) {
      return `A study named "${studyNameVal}" already exists`
    }
  }

  return null
})

/**
 * Per-field validation error state.
 * Returns a structured object indicating which specific fields have errors.
 * Sets contain the indices of duplicate items (all occurrences after the first).
 * For study name, a boolean indicates whether the name field itself has an error.
 */
const fieldValidationErrors = computed(() => {
  const studyNameVal = studyName.value.trim()

  // Study name: invalid characters or duplicate name
  let studyNameError = false
  if (studyNameVal !== '') {
    for (const ch of apiDisallowedChars.value) {
      if (studyNameVal.includes(ch)) {
        studyNameError = true
        break
      }
    }
    if (!studyNameError) {
      const conflict = studies.value.find(
        s => s.name === studyNameVal && s.id !== selectedStudyId.value
      )
      if (conflict) studyNameError = true
    }
  }

  // Duplicate prompt names: highlight all but the first occurrence
  const seenPromptNames = new Map<string, number>() // name -> first index in validPrompts
  const promptNameErrorIndices = new Set<number>()
  const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')
  for (let i = 0; i < validPrompts.length; i++) {
    const name = validPrompts[i].name.trim()
    if (seenPromptNames.has(name)) {
      promptNameErrorIndices.add(i)
    } else {
      seenPromptNames.set(name, i)
    }
  }

  // Map validPrompt error indices back to prompts array indices
  const promptErrorIndices = new Set<number>()
  let validIdx = 0
  for (let i = 0; i < prompts.value.length; i++) {
    const p = prompts.value[i]
    if (p != null && p.name.trim() !== '' && p.text.trim() !== '') {
      if (promptNameErrorIndices.has(validIdx)) {
        promptErrorIndices.add(i)
      }
      validIdx++
    }
  }

  // Duplicate steps: highlight all but the first occurrence
  const seenSteps = new Map<number, number>()
  const stepErrorIndices = new Set<number>()
  for (let i = 0; i < steps.value.length; i++) {
    const step = steps.value[i]
    if (seenSteps.has(step)) {
      stepErrorIndices.add(i)
    } else {
      seenSteps.set(step, i)
    }
  }

  // Duplicate CFGs: highlight all but the first occurrence
  const seenCfgs = new Map<number, number>()
  const cfgErrorIndices = new Set<number>()
  for (let i = 0; i < cfgs.value.length; i++) {
    const cfg = cfgs.value[i]
    if (seenCfgs.has(cfg)) {
      cfgErrorIndices.add(i)
    } else {
      seenCfgs.set(cfg, i)
    }
  }

  // Duplicate sampler/scheduler pairs: highlight all but the first occurrence
  const seenPairs = new Map<string, number>()
  const pairErrorIndices = new Set<number>()
  for (let i = 0; i < samplerSchedulerPairs.value.length; i++) {
    const pair = samplerSchedulerPairs.value[i]
    const key = `${pair.sampler}/${pair.scheduler}`
    if (seenPairs.has(key)) {
      pairErrorIndices.add(i)
    } else {
      seenPairs.set(key, i)
    }
  }

  // Duplicate LoRA strength pairs: highlight all but the first occurrence
  const seenLoraPairs = new Map<string, number>()
  const loraPairErrorIndices = new Set<number>()
  for (let i = 0; i < loraStrengthPairs.value.length; i++) {
    const pair = loraStrengthPairs.value[i]
    const key = `${pair.strength_model}/${pair.strength_clip}`
    if (seenLoraPairs.has(key)) {
      loraPairErrorIndices.add(i)
    } else {
      seenLoraPairs.set(key, i)
    }
  }

  // Duplicate seeds: highlight all but the first occurrence
  const seenSeeds = new Map<number, number>()
  const seedErrorIndices = new Set<number>()
  for (let i = 0; i < seeds.value.length; i++) {
    const seed = seeds.value[i]
    if (seenSeeds.has(seed)) {
      seedErrorIndices.add(i)
    } else {
      seenSeeds.set(seed, i)
    }
  }

  return {
    studyName: studyNameError,
    promptIndices: promptErrorIndices,
    stepIndices: stepErrorIndices,
    cfgIndices: cfgErrorIndices,
    pairIndices: pairErrorIndices,
    loraPairIndices: loraPairErrorIndices,
    seedIndices: seedErrorIndices,
  }
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
    resolutions.value.length > 0 &&
    resolutions.value.every(r => r.width > 0 && r.height > 0) &&
    localValidationError.value === null
  )
})

onMounted(async () => {
  await Promise.all([
    fetchStudies(),
    fetchSamplers(),
    fetchSchedulers(),
    fetchWorkflowOptions(),
    fetchVAEOptions(),
    fetchCLIPOptions(),
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
    // Fall back to static list when ComfyUI is unavailable or returns no options
    availableSamplers.value = result.models.length > 0 ? result.models : FALLBACK_SAMPLERS
  } catch {
    // ComfyUI might not be available — use static fallback list so the dropdown is not empty
    availableSamplers.value = FALLBACK_SAMPLERS
  }
}

async function fetchSchedulers() {
  try {
    const result = await apiClient.getComfyUIModels('scheduler')
    // Fall back to static list when ComfyUI is unavailable or returns no options
    availableSchedulers.value = result.models.length > 0 ? result.models : FALLBACK_SCHEDULERS
  } catch {
    // ComfyUI might not be available — use static fallback list so the dropdown is not empty
    availableSchedulers.value = FALLBACK_SCHEDULERS
  }
}

async function fetchWorkflowOptions() {
  try {
    availableWorkflows.value = await apiClient.listWorkflows()
  } catch {
    availableWorkflows.value = []
  }
}

async function fetchVAEOptions() {
  try {
    const result = await apiClient.getComfyUIModels('vae')
    availableVAE.value = result.models
  } catch {
    availableVAE.value = []
  }
}

async function fetchCLIPOptions() {
  try {
    const result = await apiClient.getComfyUIModels('clip')
    availableCLIP.value = result.models
  } catch {
    availableCLIP.value = []
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
  loraStrengthPairs.value = (study.lora_strength_pairs ?? []).length > 0
    ? study.lora_strength_pairs.map(p => ({ ...p }))
    : [{ strength_model: 1.0, strength_clip: 1.0 }]
  seeds.value = [...study.seeds]
  resolutions.value = (study.resolutions ?? []).length > 0
    ? study.resolutions.map(r => ({ ...r }))
    : [{ width: 1024, height: 1024 }]
  workflowTemplate.value = study.workflow_template || null
  selectedVAEs.value = [...(study.vaes ?? [])]
  selectedTextEncoders.value = [...(study.text_encoders ?? [])]
  shifts.value = [...(study.shifts ?? [])]
}

function resetForm() {
  studyName.value = ''
  promptPrefix.value = ''
  prompts.value = [{ name: '', text: '' }]
  negativePrompt.value = ''
  steps.value = [30]
  cfgs.value = [7.0]
  samplerSchedulerPairs.value = []
  loraStrengthPairs.value = [{ strength_model: 1.0, strength_clip: 1.0 }]
  seeds.value = [42]
  resolutions.value = [{ width: 1024, height: 1024 }]
  // MRU: apply most-recently-used workflow template and its associated
  // VAE, text encoder, shift, and sampler/scheduler defaults when creating a new study.
  const mruWorkflow = getMruWorkflow()
  workflowTemplate.value = mruWorkflow
  selectedVAEs.value = []
  selectedTextEncoders.value = []
  shifts.value = []
  applyMruForWorkflow(mruWorkflow)
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
    // Filter out empty prompts
    const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')

    // Save workflow template to MRU when set
    if (workflowTemplate.value) {
      saveMruWorkflow(workflowTemplate.value)
      // Save VAE and text encoder MRU for this workflow
      saveMruVaeTe(workflowTemplate.value, selectedVAEs.value, selectedTextEncoders.value, shifts.value)
      // Save sampler/scheduler pairs MRU for this workflow
      saveMruSamplerScheduler(workflowTemplate.value, samplerSchedulerPairs.value)
    }

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
          lora_strength_pairs: loraStrengthPairs.value,
          seeds: seeds.value,
          resolutions: resolutions.value,
          workflow_template: workflowTemplate.value ?? undefined,
          vaes: payloadVAEs.value,
          text_encoders: payloadTextEncoders.value,
          shifts: payloadShifts.value,
        }
      : {
          name: studyName.value.trim(),
          prompt_prefix: promptPrefix.value,
          prompts: validPrompts,
          negative_prompt: negativePrompt.value,
          steps: steps.value,
          cfgs: cfgs.value,
          sampler_scheduler_pairs: samplerSchedulerPairs.value,
          lora_strength_pairs: loraStrengthPairs.value,
          seeds: seeds.value,
          resolutions: resolutions.value,
          workflow_template: workflowTemplate.value ?? undefined,
          vaes: payloadVAEs.value,
          text_encoders: payloadTextEncoders.value,
          shifts: payloadShifts.value,
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
    // Learn disallowed chars from the backend error so future client-side validation
    // reflects the backend's authoritative set without maintaining a duplicate constant.
    const parsed = extractDisallowedCharsFromMessage(message)
    if (parsed !== null) apiDisallowedChars.value = parsed
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
    const validPrompts = prompts.value.filter(p => p != null && p.name.trim() !== '' && p.text.trim() !== '')
    // Save workflow template to MRU when set
    if (workflowTemplate.value) {
      saveMruWorkflow(workflowTemplate.value)
      // Save VAE and text encoder MRU for this workflow
      saveMruVaeTe(workflowTemplate.value, selectedVAEs.value, selectedTextEncoders.value, shifts.value)
      // Save sampler/scheduler pairs MRU for this workflow
      saveMruSamplerScheduler(workflowTemplate.value, samplerSchedulerPairs.value)
    }

    const forkPayload: ForkStudyPayload = {
      source_id: selectedStudyId.value,
      name: cloneName.value.trim(),
      prompt_prefix: promptPrefix.value,
      prompts: validPrompts,
      negative_prompt: negativePrompt.value,
      steps: steps.value,
      cfgs: cfgs.value,
      sampler_scheduler_pairs: samplerSchedulerPairs.value,
      lora_strength_pairs: loraStrengthPairs.value,
      seeds: seeds.value,
      resolutions: resolutions.value,
      workflow_template: workflowTemplate.value ?? undefined,
      vaes: payloadVAEs.value,
      text_encoders: payloadTextEncoders.value,
      shifts: payloadShifts.value,
    }

    const result = await apiClient.forkStudy(forkPayload)

    // Add the new cloned study to the list and select it
    studies.value.push(result)
    selectedStudyId.value = result.id
    studyName.value = result.name
    emit('study-saved', result)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to clone study'
    error.value = message
    const parsed = extractDisallowedCharsFromMessage(message)
    if (parsed !== null) apiDisallowedChars.value = parsed
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
    lora_strength_pairs: loraStrengthPairs.value,
    seeds: seeds.value,
    resolutions: resolutions.value,
    workflow_template: workflowTemplate.value ?? undefined,
    vaes: payloadVAEs.value,
    text_encoders: payloadTextEncoders.value,
    shifts: payloadShifts.value,
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
      loraStrengthPairs.value = (result.data.lora_strength_pairs ?? []).length > 0
        ? result.data.lora_strength_pairs!.map(p => ({ ...p }))
        : [{ strength_model: 1.0, strength_clip: 1.0 }]
      seeds.value = [...result.data.seeds]
      resolutions.value = result.data.resolutions.length > 0
        ? result.data.resolutions.map(r => ({ ...r }))
        : [{ width: 1024, height: 1024 }]
      workflowTemplate.value = result.data.workflow_template ?? null
      selectedVAEs.value = [...(result.data.vaes ?? [])]
      selectedTextEncoders.value = [...(result.data.text_encoders ?? [])]
      shifts.value = [...(result.data.shifts ?? [])]
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
  applyMruForWorkflow(name)
}

/**
 * Applies MRU defaults (VAE, text encoder, shift, sampler/scheduler) for
 * the given workflow name. Called both from the manual workflow select handler
 * and from resetForm when the MRU workflow is auto-selected.
 */
function applyMruForWorkflow(name: string | null) {
  if (name) {
    const mru = getMruVaeTeForWorkflow(name)
    if (mru) {
      selectedVAEs.value = [...mru.vaes]
      selectedTextEncoders.value = [...mru.textEncoders]
      shifts.value = [...mru.shifts]
    }
    // AC1/AC2: Apply sampler/scheduler MRU for this workflow template
    const samplerMru = getMruSamplerSchedulerForWorkflow(name)
    if (samplerMru) {
      samplerSchedulerPairs.value = samplerMru.map(p => ({ ...p }))
    }
  }
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

    <!-- Immutability dialog: shown when user edits a study that has generated samples.
         Three options: Clone, Yes, regenerate (queue jobs with clear_existing), No (ignore). -->
    <NModal
      v-model:show="showImmutabilityDialog"
      preset="dialog"
      title="Study Has Generated Samples"
      :closable="true"
      data-testid="immutability-dialog"
    >
      <p>
        This study already has generated samples. Changing its configuration will
        invalidate those samples. What would you like to do?
      </p>

      <!-- Affected runs list -->
      <div v-if="loadingAffectedRuns" style="margin: 0.75rem 0; font-style: italic;" data-testid="immutability-loading-runs">
        Loading affected training runs...
      </div>
      <div v-else-if="immutabilityAffectedRuns.length > 0" style="margin: 0.75rem 0;">
        <strong>Affected training runs (this study only):</strong>
        <ul data-testid="immutability-affected-list" style="margin: 0.5rem 0; padding-left: 1.5rem;">
          <li v-for="run in immutabilityAffectedRuns" :key="run.training_run_name" data-testid="immutability-affected-item">
            <strong>{{ run.training_run_name }}</strong>
            — {{ run.checkpoints_with_samples }}/{{ run.total_checkpoints }} checkpoints with samples
          </li>
        </ul>
      </div>

      <NSpace vertical :size="12" style="margin-top: 1rem;">
        <!-- Clone option -->
        <div class="immutability-option" data-testid="immutability-clone-section">
          <div class="immutability-option-row">
            <NInput
              v-model:value="cloneName"
              placeholder="New study name"
              size="medium"
              style="flex: 1;"
              data-testid="immutability-clone-name-input"
            />
            <NButton
              type="primary"
              :disabled="!cloneName.trim()"
              data-testid="immutability-clone-button"
              @click="cloneStudy"
            >
              Clone
            </NButton>
          </div>
          <div class="immutability-option-hint">
            Create a copy of the study with a new name. Existing samples are untouched.
          </div>
        </div>

        <!-- Yes, regenerate option -->
        <NButton
          type="warning"
          block
          data-testid="immutability-regen-button"
          @click="regenStudy"
        >
          Yes, regenerate
        </NButton>
        <div class="immutability-option-hint" data-testid="immutability-regen-hint">
          Update the study and queue regeneration jobs for the affected training runs listed
          above. Only this study's existing samples will be cleared (when each job starts) —
          other studies and training runs are not affected.
        </div>

        <!-- No option (update without regenerating) -->
        <NButton
          block
          data-testid="immutability-ignore-button"
          @click="ignoreAndSave"
        >
          No, keep existing samples
        </NButton>
        <div class="immutability-option-hint">
          Update the study without touching samples. Existing samples will no longer
          match the study's updated parameters.
        </div>
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

/* Immutability dialog option layout */
.immutability-option-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.immutability-option-hint {
  font-size: 0.8125rem;
  color: var(--text-color-secondary, #666);
  margin-top: 0.25rem;
  line-height: 1.4;
}

</style>
