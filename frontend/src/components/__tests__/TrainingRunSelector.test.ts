import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
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

  it('renders a select element with label', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    expect(wrapper.find('label').text()).toBe('Training Run')
    expect(wrapper.find('select').exists()).toBe(true)
  })

  it('shows loading state while fetching', async () => {
    mockGetTrainingRuns.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mount(TrainingRunSelector)
    await nextTick()

    const select = wrapper.find('select')
    expect((select.element as HTMLSelectElement).disabled).toBe(true)
    const defaultOption = select.find('option[disabled]')
    expect(defaultOption.text()).toBe('Loading...')
  })

  it('populates dropdown with training runs after loading', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    const options = wrapper.findAll('option')
    // 1 placeholder + 2 training runs
    expect(options).toHaveLength(3)
    expect(options[1].text()).toBe('psai4rt v0.3.0 qwen')
    expect(options[2].text()).toBe('sdxl finetune')
  })

  it('emits select event with training run when an option is selected', async () => {
    mockGetTrainingRuns.mockResolvedValue(sampleRuns)
    const wrapper = mount(TrainingRunSelector)
    await flushPromises()

    await wrapper.find('select').setValue('1')

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

    expect((wrapper.find('select').element as HTMLSelectElement).disabled).toBe(true)
  })

  describe('has-samples filter', () => {
    it('renders a has-samples checkbox that is checked by default', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="has-samples-checkbox"]')
      expect(checkbox.exists()).toBe(true)
      expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    })

    it('calls getTrainingRuns with has_samples=true on initial load', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      mount(TrainingRunSelector)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledWith(true)
    })

    it('re-fetches with has_samples=false when checkbox is unchecked', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)

      const checkbox = wrapper.find('[data-testid="has-samples-checkbox"]')
      await checkbox.setValue(false)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledWith(false)
    })

    it('re-fetches with has_samples=true when checkbox is re-checked', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Uncheck
      const checkbox = wrapper.find('[data-testid="has-samples-checkbox"]')
      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue([])
      await checkbox.setValue(false)
      await flushPromises()

      // Re-check
      mockGetTrainingRuns.mockClear()
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      await checkbox.setValue(true)
      await flushPromises()

      expect(mockGetTrainingRuns).toHaveBeenCalledWith(true)
    })

    it('resets selection when filter changes', async () => {
      mockGetTrainingRuns.mockResolvedValue(sampleRuns)
      const wrapper = mount(TrainingRunSelector)
      await flushPromises()

      // Select a run
      await wrapper.find('select').setValue('0')
      expect(wrapper.emitted('select')).toHaveLength(1)

      // Toggle filter
      mockGetTrainingRuns.mockResolvedValue([])
      const checkbox = wrapper.find('[data-testid="has-samples-checkbox"]')
      await checkbox.setValue(false)
      await flushPromises()

      // Select should be back to placeholder
      const select = wrapper.find('select')
      expect((select.element as HTMLSelectElement).value).toBe('')
    })
  })
})
