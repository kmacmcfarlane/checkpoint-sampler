import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { WorkflowSummary } from '../api/types'
import { apiClient } from '../api/client'

/**
 * Static fallback sampler list for when ComfyUI is unavailable or returns no options.
 * Covers the standard KSampler options shipped with ComfyUI.
 */
export const FALLBACK_SAMPLERS: string[] = [
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
export const FALLBACK_SCHEDULERS: string[] = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
]

/**
 * A plain { label, value } option for a Naive UI NSelect.
 *
 * Declared as a type alias rather than an interface on purpose: only type
 * aliases get an implicit index signature, which is what makes these assignable
 * to Naive UI's `SelectMixedOption` prop type.
 */
export type SelectOption = {
  label: string
  value: string
}

export interface UseStudyOptionsOptions {
  /** The currently selected workflow template name, owned by the form. */
  workflowTemplate: Ref<string | null>
}

export interface UseStudyOptions {
  availableSamplers: Ref<string[]>
  availableSchedulers: Ref<string[]>
  availableWorkflows: Ref<WorkflowSummary[]>
  availableVAE: Ref<string[]>
  availableCLIP: Ref<string[]>
  samplerOptions: ComputedRef<SelectOption[]>
  schedulerOptions: ComputedRef<SelectOption[]>
  /** Workflow options, filtered to validation_state === 'valid'. */
  workflowOptions: ComputedRef<SelectOption[]>
  vaeOptions: ComputedRef<SelectOption[]>
  clipOptions: ComputedRef<SelectOption[]>
  /** The full WorkflowSummary for the selected template, or undefined. */
  selectedWorkflowDetail: ComputedRef<WorkflowSummary | undefined>
  /** Whether the selected workflow declares a 'shift' role. */
  hasShiftRole: ComputedRef<boolean>
  /** Whether the selected workflow declares a 'vae_loader' role. */
  hasVaeRole: ComputedRef<boolean>
  /** Whether the selected workflow declares a 'clip_loader' role. */
  hasClipRole: ComputedRef<boolean>
  /** Fetch every option list in parallel. */
  fetchAll: () => Promise<void>
}

/**
 * Owns the ComfyUI / workflow option lists for the Study Editor and the
 * role-gating computeds derived from the selected workflow. Extracted from
 * StudyEditor.vue (R-021).
 *
 * Behavior preserved from the original component:
 *
 *  - Sampler and scheduler fetches fall back to the static FALLBACK_* lists both
 *    when the request throws AND when ComfyUI returns an empty list, so the
 *    dropdowns are never empty.
 *  - VAE / CLIP / workflow fetches degrade to an empty list on failure (no
 *    fallback), because there is no sensible static default for installed models.
 *  - The three has*Role computeds return false when no workflow is selected, which
 *    is what hides the VAE / CLIP / shift inputs entirely (S-157 role gating).
 */
export function useStudyOptions(options: UseStudyOptionsOptions): UseStudyOptions {
  const { workflowTemplate } = options

  const availableSamplers = ref<string[]>([])
  const availableSchedulers = ref<string[]>([])
  const availableWorkflows = ref<WorkflowSummary[]>([])
  const availableVAE = ref<string[]>([])
  const availableCLIP = ref<string[]>([])

  const samplerOptions = computed(() =>
    availableSamplers.value.map((s) => ({ label: s, value: s })),
  )

  const schedulerOptions = computed(() =>
    availableSchedulers.value.map((s) => ({ label: s, value: s })),
  )

  const workflowOptions = computed(() =>
    availableWorkflows.value
      .filter(w => w.validation_state === 'valid')
      .map(w => ({ label: w.name, value: w.name })),
  )

  const vaeOptions = computed(() =>
    availableVAE.value.map(v => ({ label: v, value: v })),
  )

  const clipOptions = computed(() =>
    availableCLIP.value.map(c => ({ label: c, value: c })),
  )

  const selectedWorkflowDetail = computed(() =>
    availableWorkflows.value.find(w => w.name === workflowTemplate.value),
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

  async function fetchSamplers(): Promise<void> {
    try {
      const result = await apiClient.getComfyUIModels('sampler')
      // Fall back to static list when ComfyUI is unavailable or returns no options
      availableSamplers.value = result.models.length > 0 ? result.models : FALLBACK_SAMPLERS
    } catch {
      // ComfyUI might not be available — use static fallback list so the dropdown is not empty
      availableSamplers.value = FALLBACK_SAMPLERS
    }
  }

  async function fetchSchedulers(): Promise<void> {
    try {
      const result = await apiClient.getComfyUIModels('scheduler')
      // Fall back to static list when ComfyUI is unavailable or returns no options
      availableSchedulers.value = result.models.length > 0 ? result.models : FALLBACK_SCHEDULERS
    } catch {
      // ComfyUI might not be available — use static fallback list so the dropdown is not empty
      availableSchedulers.value = FALLBACK_SCHEDULERS
    }
  }

  async function fetchWorkflowOptions(): Promise<void> {
    try {
      availableWorkflows.value = await apiClient.listWorkflows()
    } catch {
      availableWorkflows.value = []
    }
  }

  async function fetchVAEOptions(): Promise<void> {
    try {
      const result = await apiClient.getComfyUIModels('vae')
      availableVAE.value = result.models
    } catch {
      availableVAE.value = []
    }
  }

  async function fetchCLIPOptions(): Promise<void> {
    try {
      const result = await apiClient.getComfyUIModels('clip')
      availableCLIP.value = result.models
    } catch {
      availableCLIP.value = []
    }
  }

  async function fetchAll(): Promise<void> {
    await Promise.all([
      fetchSamplers(),
      fetchSchedulers(),
      fetchWorkflowOptions(),
      fetchVAEOptions(),
      fetchCLIPOptions(),
    ])
  }

  return {
    availableSamplers,
    availableSchedulers,
    availableWorkflows,
    availableVAE,
    availableCLIP,
    samplerOptions,
    schedulerOptions,
    workflowOptions,
    vaeOptions,
    clipOptions,
    selectedWorkflowDetail,
    hasShiftRole,
    hasVaeRole,
    hasClipRole,
    fetchAll,
  }
}
