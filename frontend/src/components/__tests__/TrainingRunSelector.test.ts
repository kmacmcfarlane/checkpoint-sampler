import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { NSelect, NCheckbox } from 'naive-ui'
import TrainingRunSelector from '../TrainingRunSelector.vue'
import type { TrainingRun } from '../../api/types'
import { GENERATE_INPUTS_STORAGE_KEY } from '../../composables/useGenerateInputsPersistence'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'

const mockGetTrainingRuns = apiClient.getTrainingRuns as ReturnType<typeof vi.fn>

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

  it('NSelect menu-props allow dropdown to expand up to 1024px wide', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    const menuProps = select.props('menuProps') as { style: string }
    expect(menuProps).toBeDefined()
    // AC: dropdown popup should expand up to 1024px (capped at viewport width)
    expect(menuProps.style).toContain('1024px')
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

  // B-098: Long name wrapping — options use renderLabel for multi-line display
  describe('long name wrapping (B-098)', () => {
    const longNameRun: TrainingRun = {
      id: 99,
      name: 'very-long-training-run-name-that-should-wrap-instead-of-truncating-with-ellipsis',
      checkpoint_count: 1,
      has_samples: true,
      checkpoints: [
        { filename: 'very-long-step00001000.safetensors', step_number: 1000, has_samples: true },
      ],
    }

    // AC1: Training run selector wraps long names instead of truncating
    it('NSelect has renderLabel prop for long name wrapping', async () => {
      mockGetTrainingRuns.mockResolvedValue([longNameRun])
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const options = select.props('options') as Array<{ label: string; value: string }>
      expect(options).toHaveLength(1)
      expect(options[0].label).toBe(longNameRun.name)
      // AC1 & AC2: renderLabel must be a prop on NSelect so Naive UI uses it for both
      // the selected value display and the dropdown options
      expect(typeof select.props('renderLabel')).toBe('function')
    })

    // AC2: Dropdown options also display full names without truncation
    it('renderLabel prop produces a span with white-space: normal for full name display', async () => {
      mockGetTrainingRuns.mockResolvedValue([longNameRun])
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const renderLabel = select.props('renderLabel') as ((opt: { label?: string }) => unknown) | undefined
      expect(renderLabel).toBeDefined()

      // Call renderLabel directly and verify it returns a VNode with wrapping styles
      const vnode = renderLabel!({ label: longNameRun.name }) as {
        props?: { style?: { whiteSpace?: string; wordBreak?: string } }
        children?: unknown
      }
      expect(vnode).toBeDefined()
      expect(vnode.props?.style?.whiteSpace).toBe('normal')
      expect(vnode.props?.style?.wordBreak).toBe('break-word')
    })

    // AC4: Unit test for long name rendering — verify the full label text is preserved
    it('preserves the full long name in the option label without truncation', async () => {
      mockGetTrainingRuns.mockResolvedValue([longNameRun])
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const options = select.props('options') as Array<{ label: string }>
      expect(options[0].label).toBe('very-long-training-run-name-that-should-wrap-instead-of-truncating-with-ellipsis')
    })

    // AC: Closed-state selected value wraps via renderTag (UAT rework)
    it('NSelect has renderTag prop so the closed-state selected value wraps', async () => {
      mockGetTrainingRuns.mockResolvedValue([longNameRun])
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      // renderTag controls how the selected value is displayed in the closed trigger
      expect(typeof select.props('renderTag')).toBe('function')
    })

    // AC: renderTag produces a span with white-space: normal for closed-state wrapping
    it('renderTag prop produces a span with white-space: normal for closed-state display', async () => {
      mockGetTrainingRuns.mockResolvedValue([longNameRun])
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const renderTag = select.props('renderTag') as
        | ((props: { option: { label?: string }; handleClose: () => void }) => unknown)
        | undefined
      expect(renderTag).toBeDefined()

      // Call renderTag directly and verify it returns a VNode with wrapping styles
      const vnode = renderTag!({
        option: { label: longNameRun.name },
        handleClose: () => {},
      }) as { props?: { style?: { whiteSpace?: string; wordBreak?: string } } }
      expect(vnode.props?.style?.whiteSpace).toBe('normal')
      expect(vnode.props?.style?.wordBreak).toBe('break-word')
    })

    // AC1 & AC2: Study NSelect also has renderLabel prop for wrapping
    it('study NSelect has renderLabel prop for long study name wrapping', async () => {
      const runsWithLongStudy: TrainingRun[] = [
        {
          id: 0,
          name: 'long-model/this-is-a-very-long-study-name-that-should-wrap/long-model',
          checkpoint_count: 1,
          has_samples: true,
          checkpoints: [
            { filename: 'long-model-step00001000.safetensors', step_number: 1000, has_samples: true },
          ],
          training_run_dir: 'long-model',
          study_label: 'this-is-a-very-long-study-name-that-should-wrap',
          study_output_dir: 'long-model/this-is-a-very-long-study-name-that-should-wrap',
        },
        {
          id: 1,
          name: 'long-model/short/long-model',
          checkpoint_count: 1,
          has_samples: true,
          checkpoints: [
            { filename: 'long-model-step00001000.safetensors', step_number: 1000, has_samples: true },
          ],
          training_run_dir: 'long-model',
          study_label: 'short',
          study_output_dir: 'long-model/short',
        },
      ]
      mockGetTrainingRuns.mockResolvedValue(runsWithLongStudy)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Select the group to trigger study dropdown population
      selectGroup(wrapper, 'long-model')
      await nextTick()

      const selects = wrapper.findAllComponents(NSelect)
      const studySelect = selects[1]
      const studyOptions = studySelect.props('options') as Array<{ label: string }>
      expect(studyOptions).toHaveLength(2)
      // AC1 & AC2: renderLabel is a prop on NSelect, not on individual options
      expect(typeof studySelect.props('renderLabel')).toBe('function')
      // AC: renderTag is also set on study NSelect so the closed-state wraps too
      expect(typeof studySelect.props('renderTag')).toBe('function')
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

  // AC1-3 (B-105): Training run selector reactively refreshes after job completion
  describe('refreshTrigger prop (B-105)', () => {
    it('does not trigger an extra refresh on initial render with refreshTrigger=0', async () => {
      // AC3: Initial value should not cause a redundant fetch beyond onMounted
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mount(TrainingRunSelector, {
        props: { refreshTrigger: 0 },
      })
      await flushPromises()

      // Only one call from onMounted — the initial watcher call with oldVal=undefined is skipped
      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(1)
    })

    it('calls getTrainingRuns again when refreshTrigger increments', async () => {
      // AC1: TR selector updates automatically when refreshTrigger changes
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const trigger = ref(0)

      const wrapper = mount(TrainingRunSelector, {
        props: { refreshTrigger: trigger.value },
      })
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(1)

      // Simulate a job completing — parent increments the trigger
      trigger.value++
      await wrapper.setProps({ refreshTrigger: trigger.value })
      await flushPromises()

      // AC2: No manual refresh needed — the selector fetched automatically
      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(2)
    })

    it('shows new sample set in options after refreshTrigger increments', async () => {
      // AC1: New sample set appears without manual refresh after job completion
      const newRun: TrainingRun = {
        id: 3,
        name: 'newly-generated-run',
        checkpoint_count: 1,
        has_samples: true,
        checkpoints: [{ filename: 'newly-generated.safetensors', step_number: 1000, has_samples: true }],
      }
      mockGetTrainingRuns.mockResolvedValueOnce(sampleRuns)
      mockGetTrainingRuns.mockResolvedValueOnce([...sampleRuns, newRun])

      const wrapper = mount(TrainingRunSelector, {
        props: { refreshTrigger: 0 },
      })
      await flushPromises()

      let options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string }>
      expect(options).toHaveLength(2)

      // Simulate job completion — parent increments trigger
      await wrapper.setProps({ refreshTrigger: 1 })
      await flushPromises()

      options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string }>
      expect(options).toHaveLength(3)
      expect(options[2].label).toBe('newly-generated-run')
    })

    it('refreshes again on each subsequent increment of refreshTrigger', async () => {
      // AC3: Multiple job completions each trigger their own refresh
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector, {
        props: { refreshTrigger: 0 },
      })
      await flushPromises()

      await wrapper.setProps({ refreshTrigger: 1 })
      await flushPromises()
      await wrapper.setProps({ refreshTrigger: 2 })
      await flushPromises()

      // Initial load + 2 reactive refreshes
      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(3)
    })
  })
})
