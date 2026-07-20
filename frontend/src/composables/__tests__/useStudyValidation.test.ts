import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useStudyValidation, type UseStudyValidationOptions } from '../useStudyValidation'
import type { Study, NamedPrompt, SamplerSchedulerPair, LoraStrengthPair, ResolutionPair } from '../../api/types'

/** Builds a valid, saveable baseline form; individual tests override one field. */
function setup(overrides: Partial<{
  studies: Study[]
  selectedStudyId: string | null
  studyName: string
  prompts: NamedPrompt[]
  steps: number[]
  cfgs: number[]
  samplerSchedulerPairs: SamplerSchedulerPair[]
  loraStrengthPairs: LoraStrengthPair[]
  seeds: number[]
  resolutions: ResolutionPair[]
  selectedVAEs: string[]
  selectedTextEncoders: string[]
  shifts: number[]
  apiDisallowedChars: string
}> = {}) {
  const opts: UseStudyValidationOptions = {
    studies: ref(overrides.studies ?? []),
    selectedStudyId: ref(overrides.selectedStudyId ?? null),
    studyName: ref(overrides.studyName ?? 'My Study'),
    prompts: ref(overrides.prompts ?? [{ name: 'p1', text: 'a cat' }]),
    steps: ref(overrides.steps ?? [30]),
    cfgs: ref(overrides.cfgs ?? [7]),
    samplerSchedulerPairs: ref(overrides.samplerSchedulerPairs ?? [{ sampler: 'euler', scheduler: 'normal' }]),
    loraStrengthPairs: ref(overrides.loraStrengthPairs ?? [{ strength_model: 1, strength_clip: 1 }]),
    seeds: ref(overrides.seeds ?? [42]),
    resolutions: ref(overrides.resolutions ?? [{ width: 1024, height: 1024 }]),
    selectedVAEs: ref(overrides.selectedVAEs ?? []),
    selectedTextEncoders: ref(overrides.selectedTextEncoders ?? []),
    shifts: ref(overrides.shifts ?? []),
    apiDisallowedChars: ref(overrides.apiDisallowedChars ?? `()/\\:*?<>|"`),
  }
  return { v: useStudyValidation(opts), opts }
}

function makeStudy(id: string, name: string): Study {
  return { id, name } as Study
}

describe('useStudyValidation', () => {
  describe('localValidationError', () => {
    it('is null for a valid form', () => {
      const { v } = setup()
      expect(v.localValidationError.value).toBeNull()
    })

    it('reports duplicate prompt names', () => {
      const { v } = setup({
        prompts: [
          { name: 'dup', text: 'a' },
          { name: 'dup', text: 'b' },
        ],
      })
      expect(v.localValidationError.value).toBe('Duplicate prompt name: "dup"')
    })

    it('ignores incomplete prompt rows when detecting duplicates', () => {
      const { v } = setup({
        prompts: [
          { name: 'p1', text: 'a' },
          { name: 'p1', text: '' },
        ],
      })
      expect(v.localValidationError.value).toBeNull()
    })

    it('reports duplicate steps, CFGs, and seeds', () => {
      expect(setup({ steps: [30, 30] }).v.localValidationError.value).toBe('Duplicate step value: 30')
      expect(setup({ cfgs: [7, 7] }).v.localValidationError.value).toBe('Duplicate CFG value: 7')
      expect(setup({ seeds: [42, 42] }).v.localValidationError.value).toBe('Duplicate seed value: 42')
    })

    it('reports duplicate sampler/scheduler pairs', () => {
      const { v } = setup({
        samplerSchedulerPairs: [
          { sampler: 'euler', scheduler: 'normal' },
          { sampler: 'euler', scheduler: 'normal' },
        ],
      })
      expect(v.localValidationError.value).toBe('Duplicate sampler/scheduler pair: euler / normal')
    })

    it('allows the same sampler with different schedulers', () => {
      const { v } = setup({
        samplerSchedulerPairs: [
          { sampler: 'euler', scheduler: 'normal' },
          { sampler: 'euler', scheduler: 'karras' },
        ],
      })
      expect(v.localValidationError.value).toBeNull()
    })

    it('reports duplicate LoRA strength pairs', () => {
      const { v } = setup({
        loraStrengthPairs: [
          { strength_model: 1, strength_clip: 1 },
          { strength_model: 1, strength_clip: 1 },
        ],
      })
      expect(v.localValidationError.value).toBe('Duplicate LoRA strength pair: model=1, clip=1')
    })

    it('reports disallowed characters in the study name', () => {
      const { v } = setup({ studyName: 'bad/name' })
      expect(v.localValidationError.value).toContain('disallowed characters')
    })

    it('uses the backend-supplied disallowed set', () => {
      const { v } = setup({ studyName: 'has#hash', apiDisallowedChars: '#' })
      expect(v.localValidationError.value).toContain('#')
    })

    it('reports a name that collides with another study', () => {
      const { v } = setup({
        studyName: 'Taken',
        studies: [makeStudy('other', 'Taken')],
      })
      expect(v.localValidationError.value).toBe('A study named "Taken" already exists')
    })

    it('does not flag the currently selected study as its own duplicate', () => {
      const { v } = setup({
        studyName: 'Taken',
        selectedStudyId: 'mine',
        studies: [makeStudy('mine', 'Taken')],
      })
      expect(v.localValidationError.value).toBeNull()
    })

    it('skips name checks entirely for an empty name', () => {
      const { v } = setup({ studyName: '   ', studies: [makeStudy('other', '')] })
      expect(v.localValidationError.value).toBeNull()
    })
  })

  describe('fieldValidationErrors', () => {
    it('flags every duplicate occurrence except the first', () => {
      const { v } = setup({ steps: [30, 30, 30, 40] })
      expect([...v.fieldValidationErrors.value.stepIndices].sort()).toEqual([1, 2])
    })

    it('maps prompt duplicate indices back to the raw prompts array', () => {
      // Index 1 is an incomplete row that must not shift the reported indices.
      const { v } = setup({
        prompts: [
          { name: 'dup', text: 'a' },
          { name: '', text: '' },
          { name: 'dup', text: 'b' },
        ],
      })
      expect([...v.fieldValidationErrors.value.promptIndices]).toEqual([2])
    })

    it('flags the study name field for a collision', () => {
      const { v } = setup({ studyName: 'Taken', studies: [makeStudy('other', 'Taken')] })
      expect(v.fieldValidationErrors.value.studyName).toBe(true)
    })

    it('leaves the study name field clean when valid', () => {
      const { v } = setup()
      expect(v.fieldValidationErrors.value.studyName).toBe(false)
    })

    it('flags duplicate LoRA and sampler pairs by index', () => {
      const { v } = setup({
        loraStrengthPairs: [
          { strength_model: 1, strength_clip: 1 },
          { strength_model: 1, strength_clip: 1 },
        ],
        samplerSchedulerPairs: [
          { sampler: 'euler', scheduler: 'normal' },
          { sampler: 'euler', scheduler: 'normal' },
        ],
      })
      expect([...v.fieldValidationErrors.value.loraPairIndices]).toEqual([1])
      expect([...v.fieldValidationErrors.value.pairIndices]).toEqual([1])
    })
  })

  describe('canSave', () => {
    it('is true for a complete valid form', () => {
      expect(setup().v.canSave.value).toBe(true)
    })

    it('is false without a name, prompt, step, cfg, pair, seed, or resolution', () => {
      expect(setup({ studyName: '  ' }).v.canSave.value).toBe(false)
      expect(setup({ prompts: [{ name: '', text: '' }] }).v.canSave.value).toBe(false)
      expect(setup({ steps: [] }).v.canSave.value).toBe(false)
      expect(setup({ cfgs: [] }).v.canSave.value).toBe(false)
      expect(setup({ samplerSchedulerPairs: [] }).v.canSave.value).toBe(false)
      expect(setup({ seeds: [] }).v.canSave.value).toBe(false)
      expect(setup({ resolutions: [] }).v.canSave.value).toBe(false)
    })

    it('is false when a sampler/scheduler pair is only partly filled', () => {
      const { v } = setup({ samplerSchedulerPairs: [{ sampler: 'euler', scheduler: '' }] })
      expect(v.canSave.value).toBe(false)
    })

    it('is false when a resolution has a non-positive dimension', () => {
      const { v } = setup({ resolutions: [{ width: 0, height: 1024 }] })
      expect(v.canSave.value).toBe(false)
    })

    it('is false whenever a validation error is present', () => {
      const { v } = setup({ steps: [30, 30] })
      expect(v.canSave.value).toBe(false)
    })
  })

  describe('computedTotalImages', () => {
    it('multiplies the base dimensions', () => {
      const { v } = setup({
        prompts: [{ name: 'p1', text: 'a' }, { name: 'p2', text: 'b' }],
        steps: [20, 30],
        cfgs: [7],
        samplerSchedulerPairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [1, 2],
        loraStrengthPairs: [],
        resolutions: [],
      })
      // 2 prompts * 2 steps * 1 cfg * 1 pair * 2 seeds
      expect(v.computedTotalImages.value).toBe(8)
    })

    it('treats empty promoted dimensions as a factor of 1 (S-157)', () => {
      const { v } = setup({ selectedVAEs: [], selectedTextEncoders: [], shifts: [] })
      expect(v.computedTotalImages.value).toBe(1)
    })

    it('multiplies by each non-empty promoted dimension', () => {
      const { v } = setup({ selectedVAEs: ['a', 'b'], shifts: [1, 2, 3] })
      // base 1 * 1 resolution * 2 vaes * 3 shifts
      expect(v.computedTotalImages.value).toBe(6)
    })

    it('multiplies by the LoRA pair count when present', () => {
      const { v } = setup({
        loraStrengthPairs: [
          { strength_model: 1, strength_clip: 1 },
          { strength_model: 0.5, strength_clip: 0.5 },
        ],
      })
      expect(v.computedTotalImages.value).toBe(2)
    })

    it('counts whitespace-only prompts toward the estimate (predicate differs from canSave - R-021)', () => {
      const { v } = setup({
        prompts: [{ name: '   ', text: 'a' }],
        steps: [20],
        cfgs: [7],
        samplerSchedulerPairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [1],
        loraStrengthPairs: [],
        resolutions: [],
      })

      expect(v.computedTotalImages.value).toBe(1)
      expect(v.canSave.value).toBe(false) // canSave trims, so it still blocks the save
    })

    it('is zero when there are no valid prompts', () => {
      const { v } = setup({ prompts: [{ name: '', text: '' }] })
      expect(v.computedTotalImages.value).toBe(0)
    })
  })

  it('recomputes reactively when the underlying form refs change', () => {
    const { v, opts } = setup()
    expect(v.localValidationError.value).toBeNull()

    opts.steps.value = [30, 30]

    expect(v.localValidationError.value).toBe('Duplicate step value: 30')
    expect(v.canSave.value).toBe(false)
  })
})
