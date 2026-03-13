import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NCheckbox } from 'naive-ui'
import TrainingRunSelector from '../TrainingRunSelector.vue'
import type { TrainingRun } from '../../api/types'
import { GENERATE_INPUTS_STORAGE_KEY } from '../../composables/useGenerateInputsPersistence'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn(),
    validateTrainingRun: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'

const mockGetTrainingRuns = apiClient.getTrainingRuns as ReturnType<typeof vi.fn>
const mockValidateTrainingRun = apiClient.validateTrainingRun as ReturnType<typeof vi.fn>

const sampleRuns: TrainingRun[] = [
  {
    id: 0,
    name: 'psai4rt v0.3.0 qwen',
    checkpoint_count: 3,
    has_samples: true,
    checkpoints: [
      { filename: 'psai4rt-v0.3.0-step00001000.safetensors', step_number: 1000, has_samples: true },
      { filename: 'psai4rt-v0.3.0-step00002000.safetensors', step_number: 2000, has_samples: true },
      { filename: 'psai4rt-v0.3.0.safetensors', step_number: 2000, has_samples: false },
    ],
  },
  {
    id: 1,
    name: 'sdxl finetune',
    checkpoint_count: 1,
    has_samples: true,
    checkpoints: [
      { filename: 'sdxl-finetune.safetensors', step_number: -1, has_samples: true },
    ],
  },
]

/** Runs with decomposed fields (new layout with study). */
const runsWithStudy: TrainingRun[] = [
  {
    id: 0,
    name: 'my-model/study-a/my-model',
    checkpoint_count: 2,
    has_samples: true,
    checkpoints: [
      { filename: 'my-model-step00001000.safetensors', step_number: 1000, has_samples: true },
      { filename: 'my-model-step00002000.safetensors', step_number: 2000, has_samples: true },
    ],
    training_run_dir: 'my-model',
    study_label: 'study-a',
    study_output_dir: 'my-model/study-a',
  },
  {
    id: 1,
    name: 'my-model/study-b/my-model',
    checkpoint_count: 1,
    has_samples: true,
    checkpoints: [
      { filename: 'my-model-step00001000.safetensors', step_number: 1000, has_samples: true },
    ],
    training_run_dir: 'my-model',
    study_label: 'study-b',
    study_output_dir: 'my-model/study-b',
  },
]

/** Mixed runs: one with samples, one without. Used to test hasSamplesFilter visibility. */
const mixedRuns: TrainingRun[] = [
  {
    id: 10,
    name: 'run-with-samples',
    checkpoint_count: 1,
    has_samples: true,
    checkpoints: [
      { filename: 'run-with-samples.safetensors', step_number: 1000, has_samples: true },
    ],
  },
  {
    id: 11,
    name: 'run-without-samples',
    checkpoint_count: 1,
    has_samples: false,
    checkpoints: [
      { filename: 'run-without-samples.safetensors', step_number: 1000, has_samples: false },
    ],
  },
]

/**
 * Helper: select a group in the training run dropdown (first NSelect).
 * For legacy runs (no training_run_dir), the group key is the run name.
 */
function selectGroup(wrapper: ReturnType<typeof mount>, groupKey: string) {
  const selects = wrapper.findAllComponents(NSelect)
  selects[0].vm.$emit('update:value', groupKey)
}

describe('TrainingRunSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders label "Training Run" and NSelect component', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    expect(wrapper.find('label').text()).toBe('Training Run')
    expect(wrapper.findComponent(NSelect).exists()).toBe(true)
  })

  it('shows loading state while fetching', async () => {
    mockGetTrainingRuns.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mount(TrainingRunSelector)
    await nextTick()

    const select = wrapper.findComponent(NSelect)
    expect(select.props('disabled')).toBe(true)
    expect(select.props('loading')).toBe(true)
  })

  it('populates NSelect with training run options after loading', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    const options = select.props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe('psai4rt v0.3.0 qwen')
    expect(options[1].label).toBe('sdxl finetune')
  })

  it('emits select event with training run and studyOutputDir when an option is selected', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    selectGroup(wrapper, 'sdxl finetune')
    await nextTick()

    const emitted = wrapper.emitted('select')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual(sampleRuns[1])
    expect(emitted![0][1]).toBe('')
  })

  it('displays error message when API call fails', async () => {
    mockGetTrainingRuns.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Failed to fetch' })
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const error = wrapper.find('[role="alert"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toBe('Failed to fetch')
  })

  it('disables select when no training runs are available', async () => {
    mockGetTrainingRuns.mockResolvedValue([])
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    expect(select.props('disabled')).toBe(true)
  })

  it('NSelect is filterable so users can type to filter training runs', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    expect(select.props('filterable')).toBe(true)
  })

  it('NSelect has consistent-menu-width=false so the dropdown can be wider than the trigger', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    expect(select.props('consistentMenuWidth')).toBe(false)
  })

  it('NSelect menu-props include min-width and max-width constraints for long names', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    const menuProps = select.props('menuProps') as { style: string }
    expect(menuProps).toBeDefined()
    expect(menuProps.style).toContain('min-width')
    expect(menuProps.style).toContain('max-width')
  })

  it('calls getTrainingRuns without arguments on initial load', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    mount(TrainingRunSelector)
    await flushPromises()

    expect(mockGetTrainingRuns).toHaveBeenCalledWith()
  })

  it('does not render a has-samples checkbox (all listed runs have samples)', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const checkbox = wrapper.find('[data-testid="has-samples-checkbox"]')
    expect(checkbox.exists()).toBe(false)
  })

  // Two-dropdown behavior
  describe('two-dropdown cascading selector', () => {
    it('groups runs by training_run_dir into a single group option', async () => {
      mockGetTrainingRuns.mockResolvedValue(runsWithStudy)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const options = select.props('options') as Array<{ label: string; value: string }>
      // Both runs share training_run_dir='my-model', so 1 group
      expect(options).toHaveLength(1)
      expect(options[0].label).toBe('my-model')
    })

    it('shows study dropdown when group has multiple studies', async () => {
      mockGetTrainingRuns.mockResolvedValue(runsWithStudy)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'my-model')
      await nextTick()

      const studySelect = wrapper.find('[data-testid="study-select"]')
      expect(studySelect.exists()).toBe(true)
    })

    it('hides study dropdown for legacy runs with no study_label', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const studySelect = wrapper.find('[data-testid="study-select"]')
      expect(studySelect.exists()).toBe(false)
    })

    it('emits select with studyOutputDir when study is selected', async () => {
      mockGetTrainingRuns.mockResolvedValue(runsWithStudy)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'my-model')
      await nextTick()

      // Select the second study
      const selects = wrapper.findAllComponents(NSelect)
      const studySelect = selects[1] // second NSelect is the study dropdown
      studySelect.vm.$emit('update:value', 'my-model/study-b')
      await nextTick()

      const emitted = wrapper.emitted('select')!
      // First emit from auto-select on group change, second from manual study select
      const lastEmit = emitted[emitted.length - 1]
      expect(lastEmit[0]).toEqual(runsWithStudy[1])
      expect(lastEmit[1]).toBe('my-model/study-b')
    })
  })

  // AC1 (S-067): hasSamplesFilter persistence
  describe('hasSamplesFilter', () => {
    it('renders has-samples checkbox when some runs have no samples', async () => {
      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="has-samples-checkbox"]')
      expect(checkbox.exists()).toBe(true)
    })

    it('defaults hasSamplesFilter to true when no preference is stored', async () => {
      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)
    })

    it('restores hasSamplesFilter=false from localStorage on mount', async () => {
      // Pre-set the preference in localStorage (as if the user previously unchecked it)
      localStorage.setItem(
        GENERATE_INPUTS_STORAGE_KEY,
        JSON.stringify({ lastWorkflowId: null, hasSamplesFilter: false, byModelType: {} })
      )

      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(false)
    })

    it('filters out runs without samples when hasSamplesFilter=true', async () => {
      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const options = select.props('options') as Array<{ label: string; value: string }>
      // Only the run with samples should appear
      expect(options).toHaveLength(1)
      expect(options[0].label).toBe('run-with-samples')
    })

    it('shows all runs when hasSamplesFilter=false', async () => {
      localStorage.setItem(
        GENERATE_INPUTS_STORAGE_KEY,
        JSON.stringify({ lastWorkflowId: null, hasSamplesFilter: false, byModelType: {} })
      )

      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const options = select.props('options') as Array<{ label: string; value: string }>
      expect(options).toHaveLength(2)
    })

    it('saves hasSamplesFilter preference to localStorage when toggled', async () => {
      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.findComponent(NCheckbox)
      // Toggle the checkbox to false
      checkbox.vm.$emit('update:checked', false)
      await nextTick()

      const stored = JSON.parse(localStorage.getItem(GENERATE_INPUTS_STORAGE_KEY) ?? '{}')
      expect(stored.hasSamplesFilter).toBe(false)
    })

    it('updates filter state immediately when toggled', async () => {
      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Initially filtered (only 1 run)
      let options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string }>
      expect(options).toHaveLength(1)

      // Toggle to show all
      const checkbox = wrapper.findComponent(NCheckbox)
      checkbox.vm.$emit('update:checked', false)
      await nextTick()

      options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string }>
      expect(options).toHaveLength(2)
    })
  })

  describe('auto-select behavior', () => {
    it('auto-selects training run when autoSelectRunId is provided and run exists', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector, {
        props: { autoSelectRunId: 1 },
      })
      await flushPromises()

      const emitted = wrapper.emitted('select')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0][0]).toEqual(sampleRuns[1])
      expect(emitted![0][1]).toBe('')
    })

    it('does not auto-select when autoSelectRunId references a stale training run', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns) // only runs 0 and 1 exist
      const wrapper = mount(TrainingRunSelector, {
        props: { autoSelectRunId: 999 },
      })
      await flushPromises()

      const emitted = wrapper.emitted('select')
      expect(emitted).toBeUndefined()
    })

    it('does not auto-select when autoSelectRunId is null', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector, {
        props: { autoSelectRunId: null },
      })
      await flushPromises()

      const emitted = wrapper.emitted('select')
      expect(emitted).toBeUndefined()
    })

    it('auto-selects only once on initial load', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector, {
        props: { autoSelectRunId: 0 },
      })
      await flushPromises()

      // First auto-select should happen
      expect(wrapper.emitted('select')).toHaveLength(1)

      // getTrainingRuns was called once on mount; auto-select should not repeat
      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(1)
    })
  })

  // AC2: Validate button beneath the selector
  describe('Validate button', () => {
    it('does not show Validate button when no training run is selected', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const btn = wrapper.find('[data-testid="validate-button"]')
      expect(btn.exists()).toBe(false)
    })

    it('shows Validate button when a training run is selected', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      expect(btn.exists()).toBe(true)
    })

    // AC3: Validate triggers the backend validation endpoint
    it('calls validateTrainingRun API when Validate button is clicked', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'ckpt1.safetensors', expected: 2, verified: 2, missing: 0 },
        ],
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      // Click validate
      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      expect(mockValidateTrainingRun).toHaveBeenCalledWith(0, undefined, undefined)
    })

    // AC6: Display validation results inline (per-checkpoint pass/warning status)
    it('displays validation results with pass status', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 3, missing: 0 },
          { checkpoint: 'model-step00002000.safetensors', expected: 3, verified: 3, missing: 0 },
        ],
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const results = wrapper.find('[data-testid="validation-results"]')
      expect(results.exists()).toBe(true)

      // Both checkpoints should show pass (checkmark)
      const checkpoints = results.findAll('.validation-checkpoint')
      expect(checkpoints).toHaveLength(2)

      // Check the first checkpoint shows pass icon (green inline style) and count
      const firstCp = checkpoints[0]
      const passIcon = firstCp.find('.validation-status-icon')
      expect(passIcon.attributes('style')).toContain('color')
      expect(firstCp.find('.validation-checkpoint-counts').text()).toBe('3/3')
    })

    it('displays validation results with warning status for missing files', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 3, missing: 0 },
          { checkpoint: 'model-step00002000.safetensors', expected: 3, verified: 1, missing: 2 },
        ],
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const results = wrapper.find('[data-testid="validation-results"]')
      expect(results.exists()).toBe(true)

      const checkpoints = results.findAll('.validation-checkpoint')
      expect(checkpoints).toHaveLength(2)

      // First checkpoint: pass (green inline style)
      const passIcon = checkpoints[0].find('.validation-status-icon')
      expect(passIcon.attributes('style')).toContain('color')

      // Second checkpoint: warning
      expect(checkpoints[1].find('.validation-status-icon--warning').exists()).toBe(true)
      expect(checkpoints[1].find('.validation-checkpoint-counts').text()).toBe('1/3')
      expect(checkpoints[1].classes()).toContain('validation-checkpoint--warning')
    })

    it('displays validation error when API call fails', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockRejectedValue({ code: 'VALIDATION_FAILED', message: 'Disk error' })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const errorEl = wrapper.find('[data-testid="validation-error"]')
      expect(errorEl.exists()).toBe(true)
      expect(errorEl.text()).toBe('Disk error')
    })

    it('clears validation results when a different training run is selected', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'ckpt.safetensors', expected: 1, verified: 1, missing: 0 },
        ],
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Select first run and validate
      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="validation-results"]').exists()).toBe(true)

      // Switch to a different run
      selectGroup(wrapper, 'sdxl finetune')
      await nextTick()

      // Results should be cleared
      expect(wrapper.find('[data-testid="validation-results"]').exists()).toBe(false)
    })

    // S-084 AC2: Show validation totals after validation
    it('displays validation totals with sample counts after validation', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 3, missing: 0 },
          { checkpoint: 'model-step00002000.safetensors', expected: 3, verified: 1, missing: 2 },
        ],
        total_expected: 6,
        total_actual: 4,
        total_missing: 2,
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const totals = wrapper.find('[data-testid="validation-totals"]')
      expect(totals.exists()).toBe(true)
      expect(totals.text()).toContain('4 / 6 samples')
      expect(totals.text()).toContain('2 missing')
    })

    it('does not show missing count in totals when all samples are present', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 3, missing: 0 },
        ],
        total_expected: 3,
        total_actual: 3,
        total_missing: 0,
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const totals = wrapper.find('[data-testid="validation-totals"]')
      expect(totals.exists()).toBe(true)
      expect(totals.text()).toContain('3 / 3 samples')
      expect(totals.text()).not.toContain('missing')
    })

    // S-084 AC2: "Generate Missing" button appears when validation fails
    it('shows "Generate Missing" button when validation reveals missing samples', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 1, missing: 2 },
        ],
        total_expected: 3,
        total_actual: 1,
        total_missing: 2,
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const generateMissingBtn = wrapper.find('[data-testid="generate-missing-button"]')
      expect(generateMissingBtn.exists()).toBe(true)
      expect(generateMissingBtn.text()).toBe('Generate Missing')
    })

    it('does not show "Generate Missing" button when no samples are missing', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 3, missing: 0 },
        ],
        total_expected: 3,
        total_actual: 3,
        total_missing: 0,
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="generate-missing-button"]').exists()).toBe(false)
    })

    it('emits generate-missing event when "Generate Missing" button is clicked', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'model-step00001000.safetensors', expected: 3, verified: 1, missing: 2 },
        ],
        total_expected: 3,
        total_actual: 1,
        total_missing: 2,
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      const generateMissingBtn = wrapper.find('[data-testid="generate-missing-button"]')
      await generateMissingBtn.trigger('click')

      expect(wrapper.emitted('generate-missing')).toBeDefined()
      expect(wrapper.emitted('generate-missing')).toHaveLength(1)
    })

    it('clears validation totals when switching training runs', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'ckpt.safetensors', expected: 1, verified: 1, missing: 0 },
        ],
        total_expected: 1,
        total_actual: 1,
        total_missing: 0,
      })

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      selectGroup(wrapper, 'psai4rt v0.3.0 qwen')
      await nextTick()

      const btn = wrapper.find('[data-testid="validate-button"]')
      await btn.trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="validation-totals"]').exists()).toBe(true)

      // Switch to a different run
      selectGroup(wrapper, 'sdxl finetune')
      await nextTick()

      expect(wrapper.find('[data-testid="validation-totals"]').exists()).toBe(false)
    })
  })

  // AC: Sample set selector has a refresh icon button to manually reload the list
  describe('refresh button', () => {
    it('renders a refresh icon button for the sample set selector', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const refreshBtn = wrapper.find('[data-testid="refresh-sample-set-button"]')
      expect(refreshBtn.exists()).toBe(true)
    })

    it('refresh button is accessible with aria-label', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const refreshBtn = wrapper.find('[data-testid="refresh-sample-set-button"]')
      expect(refreshBtn.attributes('aria-label')).toBe('Refresh sample set list')
    })

    it('clicking the refresh button calls getTrainingRuns again', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(1)

      // AC: Refresh button triggers actual data reload
      const refreshBtn = wrapper.find('[data-testid="refresh-sample-set-button"]')
      await refreshBtn.trigger('click')
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(2)
    })

    it('refresh updates the options after reload', async () => {
      const additionalRun: TrainingRun = {
        id: 2,
        name: 'new-run',
        checkpoint_count: 1,
        has_samples: true,
        checkpoints: [{ filename: 'new-run.safetensors', step_number: 1000, has_samples: true }],
      }
      mockGetTrainingRuns.mockResolvedValueOnce(sampleRuns)
      mockGetTrainingRuns.mockResolvedValueOnce([...sampleRuns, additionalRun])

      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Initially 2 runs
      let options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string }>
      expect(options).toHaveLength(2)

      // Refresh — now 3 runs appear
      const refreshBtn = wrapper.find('[data-testid="refresh-sample-set-button"]')
      await refreshBtn.trigger('click')
      await flushPromises()

      options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string }>
      expect(options).toHaveLength(3)
      expect(options[2].label).toBe('new-run')
    })
  })
})
