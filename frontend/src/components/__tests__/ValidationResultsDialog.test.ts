import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NModal, NButton, NTag, NEmpty, NSpin } from 'naive-ui'
import ValidationResultsDialog from '../ValidationResultsDialog.vue'
import type { ValidationResult, SampleJob } from '../../api/types'

// enableAutoUnmount is configured globally in vitest.setup.ts

const sampleJob: SampleJob = {
  id: 'job-1',
  training_run_name: 'my-model',
  study_id: 'study-1',
  study_name: 'Quick Test',
  workflow_name: 'flux.json',
  vae: 'ae.safetensors',
  clip: 'clip_l.safetensors',
  checkpoint_filenames: [],
  status: 'completed',
  total_items: 4,
  completed_items: 4,
  failed_items: 0,
  pending_items: 0,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const completeValidationResult: ValidationResult = {
  checkpoints: [
    { checkpoint: 'my-model-step00001000.safetensors', expected: 2, verified: 2, missing: 0 },
    { checkpoint: 'my-model-step00002000.safetensors', expected: 2, verified: 2, missing: 0 },
  ],
  expected_per_checkpoint: 2,
  total_expected: 4,
  total_verified: 4,
  total_actual: 4,
  total_missing: 0,
}

const incompleteValidationResult: ValidationResult = {
  checkpoints: [
    { checkpoint: 'my-model-step00001000.safetensors', expected: 2, verified: 2, missing: 0 },
    { checkpoint: 'my-model-step00002000.safetensors', expected: 2, verified: 1, missing: 1 },
  ],
  expected_per_checkpoint: 2,
  total_expected: 4,
  total_verified: 3,
  total_actual: 3,
  total_missing: 1,
}

describe('ValidationResultsDialog', () => {
  it('renders a modal when show is true', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('show')).toBe(true)
  })

  it('uses custom title when provided', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: null,
        loading: false,
        job: null,
        title: 'Validation: my-model',
      },
      global: { stubs: { Teleport: true } },
    })

    const modal = wrapper.findComponent(NModal)
    expect(modal.props('title')).toBe('Validation: my-model')
  })

  it('defaults to "Validation Results" title when not provided', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const modal = wrapper.findComponent(NModal)
    expect(modal.props('title')).toBe('Validation Results')
  })

  it('shows loading spinner when loading=true', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: null,
        loading: true,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const spin = wrapper.findComponent(NSpin)
    expect(spin.exists()).toBe(true)
    expect(spin.props('show')).toBe(true)
  })

  it('shows error message when error is set', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: 'Validation failed: training run not found',
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const errorEl = wrapper.find('[data-testid="validation-dialog-error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('Validation failed: training run not found')
  })

  it('shows empty state when no result and no error and not loading', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const empty = wrapper.findComponent(NEmpty)
    expect(empty.exists()).toBe(true)
  })

  it('displays validation summary with total counts', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const summary = wrapper.find('[data-testid="validation-dialog-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('4 / 4 samples')
  })

  it('shows "Complete" tag when total_missing is 0', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const completeTag = wrapper.find('[data-testid="validation-dialog-status-complete"]')
    expect(completeTag.exists()).toBe(true)
    const missingTag = wrapper.find('[data-testid="validation-dialog-status-missing"]')
    expect(missingTag.exists()).toBe(false)
  })

  it('shows "N missing" warning tag when total_missing > 0', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: incompleteValidationResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const missingTag = wrapper.find('[data-testid="validation-dialog-status-missing"]')
    expect(missingTag.exists()).toBe(true)
    expect(missingTag.text()).toContain('1 missing')
    const completeTag = wrapper.find('[data-testid="validation-dialog-status-complete"]')
    expect(completeTag.exists()).toBe(false)
  })

  it('renders per-checkpoint rows with correct counts', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const checkpoints = wrapper.find('[data-testid="validation-dialog-checkpoints"]')
    expect(checkpoints.exists()).toBe(true)
    const rows = checkpoints.findAll('.validation-checkpoint-row')
    expect(rows).toHaveLength(2)

    const counts = wrapper.find('[data-testid="validation-dialog-cp-counts-my-model-step00001000.safetensors"]')
    expect(counts.text()).toContain('2/2')
  })

  it('applies warning class to checkpoint rows with missing samples', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: incompleteValidationResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const row = wrapper.find('[data-testid="validation-dialog-cp-my-model-step00002000.safetensors"]')
    expect(row.classes()).toContain('validation-checkpoint-row--warning')
    const row1 = wrapper.find('[data-testid="validation-dialog-cp-my-model-step00001000.safetensors"]')
    expect(row1.classes()).not.toContain('validation-checkpoint-row--warning')
  })

  it('shows Regenerate button when job prop is provided', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: sampleJob,
      },
      global: { stubs: { Teleport: true } },
    })

    const regenBtn = wrapper.find('[data-testid="validation-regenerate-button"]')
    expect(regenBtn.exists()).toBe(true)
    expect(regenBtn.text()).toContain('Regenerate')
  })

  it('hides Regenerate button when no job prop', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const regenBtn = wrapper.find('[data-testid="validation-regenerate-button"]')
    expect(regenBtn.exists()).toBe(false)
  })

  it('emits regenerate with job when Regenerate button is clicked', async () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: sampleJob,
      },
      global: { stubs: { Teleport: true } },
    })

    const regenBtn = wrapper.find('[data-testid="validation-regenerate-button"]')
    await regenBtn.trigger('click')

    const emitted = wrapper.emitted('regenerate')
    expect(emitted).toBeDefined()
    expect(emitted![0][0]).toEqual(sampleJob)
  })

  it('emits close when modal requests close', async () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: null,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const modal = wrapper.findComponent(NModal)
    await modal.vm.$emit('update:show', false)
    await nextTick()

    const emitted = wrapper.emitted('close')
    expect(emitted).toBeDefined()
  })

  it('shows regenerate hint when there are missing samples and a job is provided', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: incompleteValidationResult,
        error: null,
        loading: false,
        job: sampleJob,
      },
      global: { stubs: { Teleport: true } },
    })

    const hint = wrapper.find('.validation-regenerate-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('Regenerate')
  })

  it('does not show regenerate hint when sample set is complete', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: completeValidationResult,
        error: null,
        loading: false,
        job: sampleJob,
      },
      global: { stubs: { Teleport: true } },
    })

    const hint = wrapper.find('.validation-regenerate-hint')
    expect(hint.exists()).toBe(false)
  })
})
