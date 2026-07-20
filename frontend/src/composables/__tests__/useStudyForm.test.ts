import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useStudyForm } from '../useStudyForm'
import { saveMruWorkflow, saveMruVaeTe, saveMruSamplerScheduler } from '../studyMru'
import type { Study } from '../../api/types'

function setup(roles: { vae?: boolean; clip?: boolean; shift?: boolean } = {}) {
  const hasVaeRole = ref(roles.vae ?? true)
  const hasClipRole = ref(roles.clip ?? true)
  const hasShiftRole = ref(roles.shift ?? true)
  const form = useStudyForm({ hasVaeRole, hasClipRole, hasShiftRole })
  return { form, hasVaeRole, hasClipRole, hasShiftRole }
}

function makeStudy(overrides: Partial<Study> = {}): Study {
  return {
    id: 's1',
    name: 'Study 1',
    prompt_prefix: 'photo of ',
    prompts: [{ name: 'p1', text: 'a cat' }],
    negative_prompt: 'blurry',
    steps: [30],
    cfgs: [7],
    sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
    lora_strength_pairs: [{ strength_model: 1, strength_clip: 1 }],
    seeds: [42],
    resolutions: [{ width: 1024, height: 1024 }],
    workflow_template: 'flux.json',
    vaes: ['vae-a'],
    text_encoders: ['clip-a'],
    shifts: [3],
    ...overrides,
  } as Study
}

describe('useStudyForm', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('loadStudy', () => {
    it('populates every field from the study', () => {
      const { form } = setup()
      form.loadStudy(makeStudy())

      expect(form.studyName.value).toBe('Study 1')
      expect(form.promptPrefix.value).toBe('photo of ')
      expect(form.negativePrompt.value).toBe('blurry')
      expect(form.steps.value).toEqual([30])
      expect(form.workflowTemplate.value).toBe('flux.json')
      expect(form.selectedVAEs.value).toEqual(['vae-a'])
      expect(form.shifts.value).toEqual([3])
    })

    it('deep-copies arrays so editing the form never mutates the source study', () => {
      const { form } = setup()
      const study = makeStudy()
      form.loadStudy(study)

      form.steps.value.push(40)
      form.samplerSchedulerPairs.value[0].sampler = 'dpmpp_2m'
      form.resolutions.value[0].width = 512

      expect(study.steps).toEqual([30])
      expect(study.sampler_scheduler_pairs[0].sampler).toBe('euler')
      expect(study.resolutions[0].width).toBe(1024)
    })

    it('falls back to one default row for empty LoRA pairs and resolutions', () => {
      const { form } = setup()
      form.loadStudy(makeStudy({ lora_strength_pairs: [], resolutions: [] }))

      expect(form.loraStrengthPairs.value).toEqual([{ strength_model: 1.0, strength_clip: 1.0 }])
      expect(form.resolutions.value).toEqual([{ width: 1024, height: 1024 }])
    })

    it('normalizes a falsy workflow_template to null', () => {
      const { form } = setup()
      form.loadStudy(makeStudy({ workflow_template: '' }))
      expect(form.workflowTemplate.value).toBeNull()
    })

    it('defaults absent optional dimension arrays to empty', () => {
      const { form } = setup()
      form.loadStudy(makeStudy({ vaes: undefined, text_encoders: undefined, shifts: undefined }))

      expect(form.selectedVAEs.value).toEqual([])
      expect(form.selectedTextEncoders.value).toEqual([])
      expect(form.shifts.value).toEqual([])
    })
  })

  describe('payload role gating', () => {
    it('includes the dimensions when the workflow declares all roles', () => {
      const { form } = setup({ vae: true, clip: true, shift: true })
      form.loadStudy(makeStudy())

      expect(form.payloadVAEs.value).toEqual(['vae-a'])
      expect(form.payloadTextEncoders.value).toEqual(['clip-a'])
      expect(form.payloadShifts.value).toEqual([3])
    })

    it('drops stale values for roles the workflow does not declare', () => {
      const { form, hasVaeRole, hasClipRole, hasShiftRole } = setup()
      form.loadStudy(makeStudy())

      // Simulate switching to a workflow without these roles. The form keeps the
      // user's values (inputs are only v-if hidden) but payloads must not.
      hasVaeRole.value = false
      hasClipRole.value = false
      hasShiftRole.value = false

      expect(form.selectedVAEs.value).toEqual(['vae-a'])
      expect(form.payloadVAEs.value).toEqual([])
      expect(form.payloadTextEncoders.value).toEqual([])
      expect(form.payloadShifts.value).toEqual([])
    })

    it('buildPayloadFields applies the same gating', () => {
      const { form, hasVaeRole } = setup()
      form.loadStudy(makeStudy())
      hasVaeRole.value = false

      const payload = form.buildPayloadFields()

      expect(payload.vaes).toEqual([])
      expect(payload.text_encoders).toEqual(['clip-a'])
    })
  })

  describe('buildPayloadFields', () => {
    it('trims the name and filters out incomplete prompt rows', () => {
      const { form } = setup()
      form.loadStudy(makeStudy())
      form.studyName.value = '  Padded  '
      form.prompts.value = [
        { name: 'p1', text: 'a cat' },
        { name: '', text: '' },
        { name: 'p2', text: '' },
      ]

      const payload = form.buildPayloadFields()

      expect(payload.name).toBe('Padded')
      expect(payload.prompts).toEqual([{ name: 'p1', text: 'a cat' }])
    })

    it('maps a null workflow template to undefined', () => {
      const { form } = setup()
      form.workflowTemplate.value = null
      expect(form.buildPayloadFields().workflow_template).toBeUndefined()
    })
  })

  describe('resetForm', () => {
    it('restores the documented defaults', () => {
      const { form } = setup()
      form.loadStudy(makeStudy())

      form.resetForm()

      expect(form.studyName.value).toBe('')
      expect(form.prompts.value).toEqual([{ name: '', text: '' }])
      expect(form.steps.value).toEqual([30])
      expect(form.cfgs.value).toEqual([7.0])
      expect(form.seeds.value).toEqual([42])
      expect(form.samplerSchedulerPairs.value).toEqual([])
      expect(form.resolutions.value).toEqual([{ width: 1024, height: 1024 }])
    })

    it('applies the MRU workflow and its stored dimensions', () => {
      saveMruWorkflow('flux.json')
      saveMruVaeTe('flux.json', ['vae-mru'], ['clip-mru'], [5])
      saveMruSamplerScheduler('flux.json', [{ sampler: 'dpmpp_2m', scheduler: 'karras' }])

      const { form } = setup()
      form.resetForm()

      expect(form.workflowTemplate.value).toBe('flux.json')
      expect(form.selectedVAEs.value).toEqual(['vae-mru'])
      expect(form.selectedTextEncoders.value).toEqual(['clip-mru'])
      expect(form.shifts.value).toEqual([5])
      expect(form.samplerSchedulerPairs.value).toEqual([{ sampler: 'dpmpp_2m', scheduler: 'karras' }])
    })

    it('clears dimensions when the MRU workflow has no stored entry', () => {
      saveMruWorkflow('bare.json')
      const { form } = setup()
      form.loadStudy(makeStudy())

      form.resetForm()

      expect(form.workflowTemplate.value).toBe('bare.json')
      expect(form.selectedVAEs.value).toEqual([])
      expect(form.shifts.value).toEqual([])
    })
  })

  describe('applyMruForWorkflow', () => {
    it('is a no-op for a null workflow name', () => {
      const { form } = setup()
      form.loadStudy(makeStudy())

      form.applyMruForWorkflow(null)

      expect(form.selectedVAEs.value).toEqual(['vae-a'])
    })

    it('leaves current values alone when the workflow has no MRU entry', () => {
      const { form } = setup()
      form.loadStudy(makeStudy())

      form.applyMruForWorkflow('unknown.json')

      expect(form.selectedVAEs.value).toEqual(['vae-a'])
    })
  })

  describe('persistMru', () => {
    it('round-trips the current selections for the selected workflow', () => {
      const { form } = setup()
      form.loadStudy(makeStudy())

      form.persistMru()

      const other = setup().form
      other.resetForm()
      expect(other.workflowTemplate.value).toBe('flux.json')
      expect(other.selectedVAEs.value).toEqual(['vae-a'])
      expect(other.shifts.value).toEqual([3])
    })

    it('writes nothing when no workflow is selected', () => {
      const { form } = setup()
      form.workflowTemplate.value = null

      form.persistMru()

      const other = setup().form
      other.resetForm()
      expect(other.workflowTemplate.value).toBeNull()
    })
  })
})
