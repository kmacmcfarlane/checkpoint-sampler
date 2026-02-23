import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NCheckbox } from 'naive-ui'
import TrainingRunSelector from '../TrainingRunSelector.vue'
import type { TrainingRun } from '../../api/types'

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

  describe('has-samples filter', () => {
    it('renders a has-samples NCheckbox that is unchecked by default', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.exists()).toBe(true)
      expect(checkbox.props('checked')).toBe(false)
    })

    it('calls getTrainingRuns with has_samples=false on initial load', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mount(TrainingRunSelector)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledWith(false)
    })

    it('re-fetches with has_samples=true when checkbox is checked', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)

      const checkbox = wrapper.findComponent(NCheckbox)
      checkbox.vm.$emit('update:checked', true)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledWith(true)
    })

    it('re-fetches with has_samples=false when checkbox is unchecked again', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Check
      const checkbox = wrapper.findComponent(NCheckbox)
      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue([])
      checkbox.vm.$emit('update:checked', true)
      await flushPromises()

      // Uncheck
      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      checkbox.vm.$emit('update:checked', false)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledWith(false)
    })

    it('resets selection when filter changes', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Select a run
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 0)
      await nextTick()
      expect(wrapper.emitted('select')).toHaveLength(1)

      // Toggle filter
      mockGetTrainingRuns.mockResolvedValue([])
      const checkbox = wrapper.findComponent(NCheckbox)
      checkbox.vm.$emit('update:checked', true)
      await flushPromises()

      // Select value should be reset to null
      expect(select.props('value')).toBeNull()
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

    it('auto-selects only once even if training runs list changes', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector, {
        props: { autoSelectRunId: 0 },
      })
      await flushPromises()

      // First auto-select should happen
      expect(wrapper.emitted('select')).toHaveLength(1)

      // Change the filter to trigger a refetch
      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const checkbox = wrapper.findComponent(NCheckbox)
      checkbox.vm.$emit('update:checked', true)
      await flushPromises()

      // Auto-select should not trigger again
      expect(wrapper.emitted('select')).toHaveLength(1)
    })
  })
})
