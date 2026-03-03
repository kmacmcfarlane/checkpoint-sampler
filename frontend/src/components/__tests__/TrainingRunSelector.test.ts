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

describe('TrainingRunSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a label and NSelect component', async () => {
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
    const options = select.props('options') as Array<{ label: string; value: number }>
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe('psai4rt v0.3.0 qwen')
    expect(options[1].label).toBe('sdxl finetune')
  })

  it('emits select event with training run when an option is selected', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 1)
    await nextTick()

    const emitted = wrapper.emitted('select')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual([sampleRuns[1]])
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

    it('restores hasSamplesFilter=true from localStorage on mount', async () => {
      localStorage.setItem(
        GENERATE_INPUTS_STORAGE_KEY,
        JSON.stringify({ lastWorkflowId: null, hasSamplesFilter: true, byModelType: {} })
      )

      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)
    })

    it('filters out runs without samples when hasSamplesFilter=true', async () => {
      mockGetTrainingRuns.mockResolvedValue(mixedRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      const options = select.props('options') as Array<{ label: string; value: number }>
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
      const options = select.props('options') as Array<{ label: string; value: number }>
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

    it('does not auto-select when autoSelectRunId is undefined', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector, {
        props: { autoSelectRunId: undefined },
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
})
