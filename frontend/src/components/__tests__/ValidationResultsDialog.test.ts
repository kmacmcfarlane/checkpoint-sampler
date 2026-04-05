import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NModal, NEmpty, NSpin, NCollapseItem } from 'naive-ui'
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
    { checkpoint: 'my-model-step00001000.safetensors', expected: 2, verified: 2, missing: 0, extra: 0, invalid_params: 0 },
    { checkpoint: 'my-model-step00002000.safetensors', expected: 2, verified: 2, missing: 0, extra: 0, invalid_params: 0 },
  ],
  expected_per_checkpoint: 2,
  total_expected: 4,
  total_verified: 4,
  total_actual: 4,
  total_missing: 0,
  total_extra: 0,
  total_invalid_params: 0,
}

const incompleteValidationResult: ValidationResult = {
  checkpoints: [
    { checkpoint: 'my-model-step00001000.safetensors', expected: 2, verified: 2, missing: 0, extra: 0, invalid_params: 0 },
    { checkpoint: 'my-model-step00002000.safetensors', expected: 2, verified: 1, missing: 1, extra: 0, invalid_params: 0 },
  ],
  expected_per_checkpoint: 2,
  total_expected: 4,
  total_verified: 3,
  total_actual: 3,
  total_missing: 1,
  total_extra: 0,
  total_invalid_params: 0,
}

// AC: FE: Validation status correctly reflects extra (foreign) samples.
// With the reworked validation, foreign (extra) files are NOT counted as verified.
// The 2 expected files are verified, plus 3 extra foreign files -> extra=3.
const extraSamplesResult: ValidationResult = {
  checkpoints: [
    { checkpoint: 'my-model-step00001000.safetensors', expected: 2, verified: 2, missing: 0, extra: 3, invalid_params: 0 },
    { checkpoint: 'my-model-step00002000.safetensors', expected: 2, verified: 2, missing: 0, extra: 0, invalid_params: 0 },
  ],
  expected_per_checkpoint: 2,
  total_expected: 4,
  total_verified: 4,
  total_actual: 7,
  total_missing: 0,
  total_extra: 3,
  total_invalid_params: 0,
}

// AC: FE: Validation status correctly reflects per-sample param mismatches.
// With the reworked validation, a sample with invalid params is NOT counted as
// verified -- it is counted as missing and tracked in invalid_params separately.
const invalidParamsResult: ValidationResult = {
  checkpoints: [
    // 1 expected sample has a param mismatch -> verified=1, missing=1, invalid_params=1
    { checkpoint: 'my-model-step00001000.safetensors', expected: 2, verified: 1, missing: 1, extra: 0, invalid_params: 1 },
    { checkpoint: 'my-model-step00002000.safetensors', expected: 2, verified: 2, missing: 0, extra: 0, invalid_params: 0 },
  ],
  expected_per_checkpoint: 2,
  total_expected: 4,
  total_verified: 3,
  total_actual: 3,
  total_missing: 1,
  total_extra: 0,
  total_invalid_params: 1,
}

// AC: FE: Mixed validation state with extra, missing, and invalid params across checkpoints.
const mixedIssuesResult: ValidationResult = {
  checkpoints: [
    { checkpoint: 'cp-A.safetensors', expected: 4, verified: 4, missing: 0, extra: 0, invalid_params: 0 },
    { checkpoint: 'cp-B.safetensors', expected: 4, verified: 2, missing: 2, extra: 1, invalid_params: 1 },
    { checkpoint: 'cp-C.safetensors', expected: 4, verified: 0, missing: 4, extra: 0, invalid_params: 0 },
  ],
  expected_per_checkpoint: 4,
  total_expected: 12,
  total_verified: 6,
  total_actual: 7,
  total_missing: 6,
  total_extra: 1,
  total_invalid_params: 1,
}

// AC: FE: Empty report (no checkpoints) handled gracefully.
const emptyResult: ValidationResult = {
  checkpoints: [],
  expected_per_checkpoint: 0,
  total_expected: 0,
  total_verified: 0,
  total_actual: 0,
  total_missing: 0,
  total_extra: 0,
  total_invalid_params: 0,
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

  it('shows "Complete" tag when there are no missing, extra, or invalid params', () => {
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
    const issuesTag = wrapper.find('[data-testid="validation-dialog-status-issues"]')
    expect(issuesTag.exists()).toBe(false)
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

    const issuesTag = wrapper.find('[data-testid="validation-dialog-status-issues"]')
    expect(issuesTag.exists()).toBe(true)
    expect(issuesTag.text()).toContain('1 missing')
    const completeTag = wrapper.find('[data-testid="validation-dialog-status-complete"]')
    expect(completeTag.exists()).toBe(false)
  })

  // AC: FE: Validation status correctly reflects per-sample param mismatches
  it('shows warning tag with extra count when total_extra > 0', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: extraSamplesResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const issuesTag = wrapper.find('[data-testid="validation-dialog-status-issues"]')
    expect(issuesTag.exists()).toBe(true)
    expect(issuesTag.text()).toContain('3 extra')
    const completeTag = wrapper.find('[data-testid="validation-dialog-status-complete"]')
    expect(completeTag.exists()).toBe(false)
  })

  // AC: FE: Validation status correctly reflects per-sample param mismatches
  it('shows warning tag with param mismatch count when total_invalid_params > 0', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: invalidParamsResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const issuesTag = wrapper.find('[data-testid="validation-dialog-status-issues"]')
    expect(issuesTag.exists()).toBe(true)
    expect(issuesTag.text()).toContain('1 param mismatch')
    const completeTag = wrapper.find('[data-testid="validation-dialog-status-complete"]')
    expect(completeTag.exists()).toBe(false)
  })

  // AC: FE: Extra samples shown at per-checkpoint level
  it('shows extra badge on checkpoints with extra samples', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: extraSamplesResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const extraBadge = wrapper.find('[data-testid="validation-dialog-cp-extra-my-model-step00001000.safetensors"]')
    expect(extraBadge.exists()).toBe(true)
    expect(extraBadge.text()).toContain('+3')
  })

  // AC: FE: Param mismatch shown at per-checkpoint level
  it('shows invalid params badge on checkpoints with param mismatches', () => {
    const wrapper = mount(ValidationResultsDialog, {
      props: {
        show: true,
        result: invalidParamsResult,
        error: null,
        loading: false,
        job: null,
      },
      global: { stubs: { Teleport: true } },
    })

    const invalidBadge = wrapper.find('[data-testid="validation-dialog-cp-invalid-my-model-step00001000.safetensors"]')
    expect(invalidBadge.exists()).toBe(true)
    expect(invalidBadge.text()).toContain('param mismatch')
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

    // NCollapse with NCollapseItem should render for each checkpoint
    const collapseItems = wrapper.findAllComponents(NCollapseItem)
    expect(collapseItems).toHaveLength(2)

    const counts = wrapper.find('[data-testid="validation-dialog-cp-counts-my-model-step00001000.safetensors"]')
    expect(counts.text()).toContain('2/2')
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

  // AC: FE: Refresh button is visible in the validation dialog
  it('shows Refresh button in the header', () => {
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

    const refreshBtn = wrapper.find('[data-testid="validation-refresh-button"]')
    expect(refreshBtn.exists()).toBe(true)
    expect(refreshBtn.text()).toContain('Refresh')
  })

  // AC: FE: Clicking refresh re-triggers validation and updates displayed results
  it('emits refresh when Refresh button is clicked', async () => {
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

    const refreshBtn = wrapper.find('[data-testid="validation-refresh-button"]')
    await refreshBtn.trigger('click')

    const emitted = wrapper.emitted('refresh')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
  })

  // AC: FE: Loading state is shown during refresh
  it('shows loading state on Refresh button when loading=true', () => {
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

    const refreshBtn = wrapper.find('[data-testid="validation-refresh-button"]')
    expect(refreshBtn.exists()).toBe(true)
    expect(refreshBtn.attributes('disabled')).toBeDefined()
  })

  // AC: FE: Refresh button is enabled when not loading
  it('Refresh button is enabled when not loading', () => {
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

    const refreshBtn = wrapper.find('[data-testid="validation-refresh-button"]')
    expect(refreshBtn.exists()).toBe(true)
    expect(refreshBtn.attributes('disabled')).toBeUndefined()
  })

  it('shows regenerate hint when there are validation issues and a job is provided', () => {
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

  // ----------------------------------------------------------------
  // AC: FE: Validation dialog displays per-checkpoint breakdown
  //     (expected, valid, missing, invalid for each file type)
  // ----------------------------------------------------------------

  describe('per-checkpoint file-type breakdown table', () => {
    // AC: FE: Per-checkpoint breakdown shows expected, valid, missing, invalid for each file type
    it('renders summary breakdown table with PNG and JSON rows', () => {
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

      const table = wrapper.find('[data-testid="validation-summary-breakdown"]')
      expect(table.exists()).toBe(true)

      // Should have PNG samples and JSON metadata rows
      const pngRow = wrapper.find('[data-testid="validation-summary-ft-png-samples"]')
      expect(pngRow.exists()).toBe(true)
      expect(pngRow.text()).toContain('PNG samples')

      const jsonRow = wrapper.find('[data-testid="validation-summary-ft-json-metadata"]')
      expect(jsonRow.exists()).toBe(true)
      expect(jsonRow.text()).toContain('JSON metadata')
    })

    // AC: FE: Total summary row shows aggregate counts across all checkpoints
    it('renders summary totals row with aggregate counts', () => {
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

      const totalsRow = wrapper.find('[data-testid="validation-summary-totals"]')
      expect(totalsRow.exists()).toBe(true)
      expect(totalsRow.text()).toContain('Totals')
      // total_expected=4, total_verified=3, total_missing=1, total_invalid_params=0
      expect(totalsRow.text()).toContain('4')
      expect(totalsRow.text()).toContain('3')
      expect(totalsRow.text()).toContain('1')
    })

    // AC: FE: Per-checkpoint file-type breakdown renders for each checkpoint
    it('renders per-checkpoint breakdown tables inside collapse items', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: invalidParamsResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      // The collapse should have 2 items
      const collapseItems = wrapper.findAllComponents(NCollapseItem)
      expect(collapseItems).toHaveLength(2)
    })

    // AC: FE: Summary breakdown shows correct values for mixed issues
    it('shows correct summary breakdown values for mixed issues', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: mixedIssuesResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      const summary = wrapper.find('[data-testid="validation-dialog-summary"]')
      expect(summary.text()).toContain('7 / 12 samples')

      const issuesTag = wrapper.find('[data-testid="validation-dialog-status-issues"]')
      expect(issuesTag.exists()).toBe(true)
      expect(issuesTag.text()).toContain('6 missing')
      expect(issuesTag.text()).toContain('1 extra')
      expect(issuesTag.text()).toContain('1 param mismatch')
    })
  })

  // ----------------------------------------------------------------
  // AC: FE: Extra/unexpected files are flagged in the report
  // ----------------------------------------------------------------

  describe('extra/unexpected files flagging', () => {
    // AC: FE: Extra files summary appears when total_extra > 0
    it('shows extra files summary when total_extra > 0', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: extraSamplesResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      const extraSummary = wrapper.find('[data-testid="validation-summary-extra"]')
      expect(extraSummary.exists()).toBe(true)
      expect(extraSummary.text()).toContain('3 extra/unexpected files detected')
    })

    // AC: FE: Extra files summary hidden when total_extra === 0
    it('hides extra files summary when total_extra === 0', () => {
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

      const extraSummary = wrapper.find('[data-testid="validation-summary-extra"]')
      expect(extraSummary.exists()).toBe(false)
    })

    // AC: FE: Per-checkpoint extra flag appears for checkpoints with extra files
    it('shows per-checkpoint extra flag for checkpoints with extra files', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: extraSamplesResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      const extraFlag = wrapper.find('[data-testid="validation-cp-extra-flag-my-model-step00001000.safetensors"]')
      expect(extraFlag.exists()).toBe(true)
      expect(extraFlag.text()).toContain('3 extra/unexpected files')
    })

    // AC: FE: Singular form for 1 extra file
    it('uses singular form for 1 extra file in summary', () => {
      const singleExtraResult: ValidationResult = {
        checkpoints: [
          { checkpoint: 'cp-A.safetensors', expected: 2, verified: 2, missing: 0, extra: 1, invalid_params: 0 },
        ],
        expected_per_checkpoint: 2,
        total_expected: 2,
        total_verified: 2,
        total_actual: 3,
        total_missing: 0,
        total_extra: 1,
        total_invalid_params: 0,
      }

      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: singleExtraResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      const extraSummary = wrapper.find('[data-testid="validation-summary-extra"]')
      expect(extraSummary.exists()).toBe(true)
      expect(extraSummary.text()).toContain('1 extra/unexpected file detected')
      expect(extraSummary.text()).not.toContain('files')
    })
  })

  // ----------------------------------------------------------------
  // AC: FE: Unit tests for report display with various validation states
  // ----------------------------------------------------------------

  describe('various validation states', () => {
    // AC: FE: Dialog handles empty reports (no checkpoints) gracefully
    it('handles empty result (no checkpoints) gracefully', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: emptyResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      const summary = wrapper.find('[data-testid="validation-dialog-summary"]')
      expect(summary.exists()).toBe(true)
      expect(summary.text()).toContain('0 / 0 samples')

      const completeTag = wrapper.find('[data-testid="validation-dialog-status-complete"]')
      expect(completeTag.exists()).toBe(true)

      // No checkpoint collapse items
      const collapseItems = wrapper.findAllComponents(NCollapseItem)
      expect(collapseItems).toHaveLength(0)

      // No extra summary
      const extraSummary = wrapper.find('[data-testid="validation-summary-extra"]')
      expect(extraSummary.exists()).toBe(false)
    })

    // AC: FE: Mixed states: some checkpoints fully valid, some with missing, some with param mismatches, some with extra
    it('renders mixed validation states across multiple checkpoints', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: mixedIssuesResult,
          error: null,
          loading: false,
          job: sampleJob,
        },
        global: { stubs: { Teleport: true } },
      })

      // 3 collapse items for 3 checkpoints
      const collapseItems = wrapper.findAllComponents(NCollapseItem)
      expect(collapseItems).toHaveLength(3)

      // cp-A is fully valid (pass icon)
      const cpACounts = wrapper.find('[data-testid="validation-dialog-cp-counts-cp-A.safetensors"]')
      expect(cpACounts.text()).toContain('4/4')

      // cp-B has extra and invalid params
      const cpBExtra = wrapper.find('[data-testid="validation-dialog-cp-extra-cp-B.safetensors"]')
      expect(cpBExtra.exists()).toBe(true)
      expect(cpBExtra.text()).toContain('+1')

      const cpBInvalid = wrapper.find('[data-testid="validation-dialog-cp-invalid-cp-B.safetensors"]')
      expect(cpBInvalid.exists()).toBe(true)
      expect(cpBInvalid.text()).toContain('param mismatch')

      // cp-C has all missing
      const cpCCounts = wrapper.find('[data-testid="validation-dialog-cp-counts-cp-C.safetensors"]')
      expect(cpCCounts.text()).toContain('0/4')

      // Regenerate hint should appear (issues + job provided)
      const hint = wrapper.find('.validation-regenerate-hint')
      expect(hint.exists()).toBe(true)
    })

    // AC: FE: Combined extra and missing in warning tag
    it('shows combined warning tag with extra and missing', () => {
      const wrapper = mount(ValidationResultsDialog, {
        props: {
          show: true,
          result: mixedIssuesResult,
          error: null,
          loading: false,
          job: null,
        },
        global: { stubs: { Teleport: true } },
      })

      const issuesTag = wrapper.find('[data-testid="validation-dialog-status-issues"]')
      expect(issuesTag.exists()).toBe(true)
      const text = issuesTag.text()
      // Should contain all three issue types
      expect(text).toContain('missing')
      expect(text).toContain('extra')
      expect(text).toContain('param mismatch')
    })

    // AC: FE: All checkpoints fully valid shows complete state
    it('shows complete state when all checkpoints are fully valid', () => {
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
      expect(completeTag.text()).toBe('Complete')

      // No extra summary
      const extraSummary = wrapper.find('[data-testid="validation-summary-extra"]')
      expect(extraSummary.exists()).toBe(false)
    })
  })
})
