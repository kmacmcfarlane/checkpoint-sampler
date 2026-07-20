import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type {
  NamedPrompt,
  SamplerSchedulerPair,
  LoraStrengthPair,
  ResolutionPair,
  CreateStudyPayload,
} from '../api/types'
import {
  getMruWorkflow,
  getMruVaeTeForWorkflow,
  getMruSamplerSchedulerForWorkflow,
  saveMruWorkflow,
  saveMruVaeTe,
  saveMruSamplerScheduler,
} from './studyMru'

/** Default LoRA strength pair used when a study has none. */
function defaultLoraPair(): LoraStrengthPair {
  return { strength_model: 1.0, strength_clip: 1.0 }
}

/** Default resolution used when a study has none. */
function defaultResolution(): ResolutionPair {
  return { width: 1024, height: 1024 }
}

/**
 * The subset of an imported/loaded study the form can populate itself from.
 * Both {@link Study} and a validated import payload structurally satisfy this.
 */
export interface StudyFormSource {
  name: string
  prompt_prefix: string
  prompts: NamedPrompt[]
  negative_prompt: string
  steps: number[]
  cfgs: number[]
  sampler_scheduler_pairs: SamplerSchedulerPair[]
  lora_strength_pairs?: LoraStrengthPair[]
  seeds: number[]
  resolutions?: ResolutionPair[]
  workflow_template?: string | null
  vaes?: string[]
  text_encoders?: string[]
  shifts?: number[]
}

export interface UseStudyFormOptions {
  /** Whether the selected workflow declares a 'vae_loader' role. */
  hasVaeRole: Ref<boolean> | ComputedRef<boolean>
  /** Whether the selected workflow declares a 'clip_loader' role. */
  hasClipRole: Ref<boolean> | ComputedRef<boolean>
  /** Whether the selected workflow declares a 'shift' role. */
  hasShiftRole: Ref<boolean> | ComputedRef<boolean>
}

export interface UseStudyForm {
  studyName: Ref<string>
  promptPrefix: Ref<string>
  prompts: Ref<NamedPrompt[]>
  negativePrompt: Ref<string>
  steps: Ref<number[]>
  cfgs: Ref<number[]>
  samplerSchedulerPairs: Ref<SamplerSchedulerPair[]>
  loraStrengthPairs: Ref<LoraStrengthPair[]>
  seeds: Ref<number[]>
  resolutions: Ref<ResolutionPair[]>
  workflowTemplate: Ref<string | null>
  selectedVAEs: Ref<string[]>
  selectedTextEncoders: Ref<string[]>
  shifts: Ref<number[]>
  /** Role-gated VAE list for payloads (empty when the workflow has no vae_loader role). */
  payloadVAEs: ComputedRef<string[]>
  /** Role-gated text-encoder list for payloads. */
  payloadTextEncoders: ComputedRef<string[]>
  /** Role-gated shift list for payloads. */
  payloadShifts: ComputedRef<number[]>
  /** Populate the form from an existing study (or a validated import payload). */
  loadStudy: (study: StudyFormSource) => void
  /** Reset the form to defaults and apply the MRU workflow and its saved dimensions. */
  resetForm: () => void
  /** Apply MRU defaults (VAE / text encoder / shift / sampler-scheduler) for a workflow. */
  applyMruForWorkflow: (name: string | null) => void
  /** Persist the current dimension selections as the MRU for the selected workflow. */
  persistMru: () => void
  /** Build the common study payload fields shared by create / update / fork / export. */
  buildPayloadFields: () => CreateStudyPayload
}

/**
 * Owns the Study Editor's form state plus the load / reset / payload-building
 * logic around it. Extracted from StudyEditor.vue (R-021).
 *
 * Behavior preserved verbatim from the original component:
 *
 *  - loadStudy COPIES arrays and objects (spread / map) rather than aliasing the
 *    source study, so editing the form never mutates the cached studies list.
 *  - Empty lora_strength_pairs and resolutions fall back to a single default
 *    entry, because the form requires at least one row to be editable.
 *  - `workflow_template` normalizes falsy values to null so the NSelect shows its
 *    placeholder rather than an empty-string selection.
 *  - resetForm applies the MRU workflow AND its saved dimensions, but clears
 *    VAE/CLIP/shift first so a workflow with no stored MRU starts empty rather
 *    than inheriting the previous study's values.
 *  - payload* computeds gate each promoted dimension on the workflow declaring the
 *    matching role. The form intentionally KEEPS user-entered values when
 *    switching to a workflow without the role (the inputs are only v-if hidden),
 *    so this gating is the single place that prevents stale values from being
 *    persisted and silently multiplying the cross-product.
 */
export function useStudyForm(options: UseStudyFormOptions): UseStudyForm {
  const { hasVaeRole, hasClipRole, hasShiftRole } = options

  const studyName = ref('')
  const promptPrefix = ref('')
  const prompts = ref<NamedPrompt[]>([{ name: '', text: '' }])
  const negativePrompt = ref('')
  const steps = ref<number[]>([30])
  const cfgs = ref<number[]>([7.0])
  const samplerSchedulerPairs = ref<SamplerSchedulerPair[]>([])
  const loraStrengthPairs = ref<LoraStrengthPair[]>([defaultLoraPair()])
  const seeds = ref<number[]>([42])
  // S-157: resolution is a paired multi-value dimension (mirrors LoRA strength pairs).
  const resolutions = ref<ResolutionPair[]>([defaultResolution()])
  const workflowTemplate = ref<string | null>(null)
  // S-157: VAE / text-encoder / shift are multi-value dimensions gated by workflow roles.
  const selectedVAEs = ref<string[]>([])
  const selectedTextEncoders = ref<string[]>([])
  const shifts = ref<number[]>([])

  const payloadVAEs = computed(() => (hasVaeRole.value ? selectedVAEs.value : []))
  const payloadTextEncoders = computed(() => (hasClipRole.value ? selectedTextEncoders.value : []))
  const payloadShifts = computed(() => (hasShiftRole.value ? shifts.value : []))

  function loadStudy(study: StudyFormSource): void {
    studyName.value = study.name
    promptPrefix.value = study.prompt_prefix
    // NOTE: no empty-list fallback here. The import path normalizes an empty
    // prompt list to a single blank row before calling loadStudy; loading a
    // saved study keeps whatever it has, matching the original component.
    prompts.value = [...study.prompts]
    negativePrompt.value = study.negative_prompt
    steps.value = [...study.steps]
    cfgs.value = [...study.cfgs]
    samplerSchedulerPairs.value = study.sampler_scheduler_pairs.map(p => ({ ...p }))
    loraStrengthPairs.value = (study.lora_strength_pairs ?? []).length > 0
      ? study.lora_strength_pairs!.map(p => ({ ...p }))
      : [defaultLoraPair()]
    seeds.value = [...study.seeds]
    resolutions.value = (study.resolutions ?? []).length > 0
      ? study.resolutions!.map(r => ({ ...r }))
      : [defaultResolution()]
    workflowTemplate.value = study.workflow_template || null
    selectedVAEs.value = [...(study.vaes ?? [])]
    selectedTextEncoders.value = [...(study.text_encoders ?? [])]
    shifts.value = [...(study.shifts ?? [])]
  }

  function applyMruForWorkflow(name: string | null): void {
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

  function resetForm(): void {
    studyName.value = ''
    promptPrefix.value = ''
    prompts.value = [{ name: '', text: '' }]
    negativePrompt.value = ''
    steps.value = [30]
    cfgs.value = [7.0]
    samplerSchedulerPairs.value = []
    loraStrengthPairs.value = [defaultLoraPair()]
    seeds.value = [42]
    resolutions.value = [defaultResolution()]
    // MRU: apply most-recently-used workflow template and its associated
    // VAE, text encoder, shift, and sampler/scheduler defaults when creating a new study.
    const mruWorkflow = getMruWorkflow()
    workflowTemplate.value = mruWorkflow
    selectedVAEs.value = []
    selectedTextEncoders.value = []
    shifts.value = []
    applyMruForWorkflow(mruWorkflow)
  }

  function persistMru(): void {
    if (workflowTemplate.value) {
      saveMruWorkflow(workflowTemplate.value)
      // Save VAE and text encoder MRU for this workflow
      saveMruVaeTe(workflowTemplate.value, selectedVAEs.value, selectedTextEncoders.value, shifts.value)
      // Save sampler/scheduler pairs MRU for this workflow
      saveMruSamplerScheduler(workflowTemplate.value, samplerSchedulerPairs.value)
    }
  }

  function buildPayloadFields(): CreateStudyPayload {
    return {
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
  }

  return {
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
    payloadVAEs,
    payloadTextEncoders,
    payloadShifts,
    loadStudy,
    resetForm,
    applyMruForWorkflow,
    persistMru,
    buildPayloadFields,
  }
}
