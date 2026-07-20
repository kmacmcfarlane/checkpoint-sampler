import { computed, type Ref, type ComputedRef } from 'vue'
import type {
  Study,
  NamedPrompt,
  SamplerSchedulerPair,
  LoraStrengthPair,
  ResolutionPair,
} from '../api/types'

/**
 * Per-field validation error state.
 *
 * Each Set contains the indices of duplicate items (all occurrences AFTER the
 * first), which is what drives the per-row/per-tag error highlighting.
 */
export interface StudyFieldValidationErrors {
  /** True when the study name has invalid characters or collides with another study. */
  studyName: boolean
  promptIndices: Set<number>
  stepIndices: Set<number>
  cfgIndices: Set<number>
  pairIndices: Set<number>
  loraPairIndices: Set<number>
  seedIndices: Set<number>
}

/**
 * The form state the validators read. All refs are owned by the Study Editor
 * form; this composable only derives from them.
 */
export interface UseStudyValidationOptions {
  studies: Ref<Study[]>
  selectedStudyId: Ref<string | null>
  studyName: Ref<string>
  prompts: Ref<NamedPrompt[]>
  steps: Ref<number[]>
  cfgs: Ref<number[]>
  samplerSchedulerPairs: Ref<SamplerSchedulerPair[]>
  loraStrengthPairs: Ref<LoraStrengthPair[]>
  seeds: Ref<number[]>
  resolutions: Ref<ResolutionPair[]>
  selectedVAEs: Ref<string[]>
  selectedTextEncoders: Ref<string[]>
  shifts: Ref<number[]>
  /**
   * Disallowed characters for study names. Backend-authoritative: seeded with a
   * bootstrap default and replaced from the API error on the first rejected save.
   */
  apiDisallowedChars: Ref<string>
}

export interface UseStudyValidation {
  /** The first validation problem as a user-facing message, or null when valid. */
  localValidationError: ComputedRef<string | null>
  /** Structured per-field error state for inline highlighting. */
  fieldValidationErrors: ComputedRef<StudyFieldValidationErrors>
  /** Whether the study can be saved (all required fields present and valid). */
  canSave: ComputedRef<boolean>
  /** Size of the Cartesian product of all dimensions, per checkpoint. */
  computedTotalImages: ComputedRef<number>
}

/** A prompt counts toward validation only when both name and text are non-empty. */
function isValidPrompt(p: NamedPrompt | null | undefined): boolean {
  return p != null && p.name.trim() !== '' && p.text.trim() !== ''
}

/**
 * Owns the Study Editor's validation and total-image derivations. Extracted from
 * StudyEditor.vue (R-021) so the duplicate-detection rules can be unit-tested
 * directly instead of only through the mounted form.
 *
 * Behavior preserved verbatim from the original component:
 *
 *  - localValidationError returns the FIRST problem found, in a fixed order
 *    (prompt names → steps → CFGs → sampler/scheduler pairs → LoRA pairs → seeds
 *    → disallowed name chars → duplicate name). Message strings are unchanged
 *    because tests and users match on them.
 *  - Duplicate detection keeps the first occurrence clean and flags every later
 *    one, so the user sees which entry is the offending copy.
 *  - Prompt duplicate indices are computed over the FILTERED valid-prompt list and
 *    then mapped back to indices in the raw prompts array, so highlighting lines
 *    up with the rendered rows even when blank rows are interleaved.
 *  - The name checks are skipped entirely for an empty (trimmed) name — an empty
 *    name is a "not ready to save" condition (canSave), not a validation error.
 *  - The duplicate-name check excludes the currently selected study so editing a
 *    study without renaming it is not a conflict.
 *  - computedTotalImages multiplies the base product by each promoted dimension,
 *    treating an EMPTY dimension as a factor of 1 rather than 0 (S-157), and
 *    likewise only applies the LoRA pair count when non-zero.
 */
export function useStudyValidation(options: UseStudyValidationOptions): UseStudyValidation {
  const {
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
  } = options

  const computedTotalImages = computed(() => {
    // NOTE: intentionally NOT isValidPrompt. The original used a truthiness check
    // here (not trim), so whitespace-only prompts count toward the estimate. This
    // differs from localValidationError / fieldValidationErrors by design; see R-021.
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

  const localValidationError = computed((): string | null => {
    // Check for duplicate prompt names (slugs)
    const validPrompts = prompts.value.filter(isValidPrompt)
    const seenPromptNames = new Set<string>()
    for (const p of validPrompts) {
      const name = p.name.trim()
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
        s => s.name === studyNameVal && s.id !== selectedStudyId.value,
      )
      if (conflict) {
        return `A study named "${studyNameVal}" already exists`
      }
    }

    return null
  })

  const fieldValidationErrors = computed((): StudyFieldValidationErrors => {
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
          s => s.name === studyNameVal && s.id !== selectedStudyId.value,
        )
        if (conflict) studyNameError = true
      }
    }

    // Duplicate prompt names: highlight all but the first occurrence
    const seenPromptNames = new Map<string, number>() // name -> first index in validPrompts
    const promptNameErrorIndices = new Set<number>()
    const validPrompts = prompts.value.filter(isValidPrompt)
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
      if (isValidPrompt(prompts.value[i])) {
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
      prompts.value.some(isValidPrompt) &&
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

  return {
    localValidationError,
    fieldValidationErrors,
    canSave,
    computedTotalImages,
  }
}
