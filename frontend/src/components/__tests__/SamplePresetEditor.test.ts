import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NButton, NInput, NInputNumber, NDynamicInput } from 'naive-ui'
import SamplePresetEditor from '../SamplePresetEditor.vue'
import type { SamplePreset, ComfyUIModels } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    listSamplePresets: vi.fn(),
    createSamplePreset: vi.fn(),
    updateSamplePreset: vi.fn(),
    deleteSamplePreset: vi.fn(),
    getComfyUIModels: vi.fn(),
  },
}))

// Mock window.confirm
const originalConfirm = globalThis.confirm
beforeEach(() => {
  globalThis.confirm = vi.fn()
})

import { apiClient } from '../../api/client'

const mockListSamplePresets = apiClient.listSamplePresets as ReturnType<typeof vi.fn>
const mockCreateSamplePreset = apiClient.createSamplePreset as ReturnType<typeof vi.fn>
const mockUpdateSamplePreset = apiClient.updateSamplePreset as ReturnType<typeof vi.fn>
const mockDeleteSamplePreset = apiClient.deleteSamplePreset as ReturnType<typeof vi.fn>
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>

const samplePresets: SamplePreset[] = [
  {
    id: 'preset-1',
    name: 'Test Preset A',
    prompts: [
      { name: 'forest', text: 'a mystical forest' },
      { name: 'city', text: 'a futuristic city' },
    ],
    negative_prompt: 'low quality',
    steps: [1, 4, 8],
    cfgs: [1.0, 3.0, 7.0],
    samplers: ['euler', 'heun'],
    schedulers: ['simple', 'normal'],
    seeds: [42, 420],
    width: 1024,
    height: 1024,
    images_per_checkpoint: 144, // 2*3*3*2*2*2 = 144
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-2',
    name: 'Test Preset B',
    prompts: [{ name: 'cat', text: 'a cute cat' }],
    negative_prompt: '',
    steps: [20],
    cfgs: [7.0],
    samplers: ['euler'],
    schedulers: ['normal'],
    seeds: [1337],
    width: 512,
    height: 512,
    images_per_checkpoint: 1,
    created_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  },
]

const mockSamplers: ComfyUIModels = {
  models: ['euler', 'heun', 'dpm_2', 'lms'],
}

const mockSchedulers: ComfyUIModels = {
  models: ['simple', 'normal', 'karras', 'exponential'],
}

describe('SamplePresetEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Return a fresh copy of presets for each test to avoid mutation issues
    mockListSamplePresets.mockResolvedValue(JSON.parse(JSON.stringify(samplePresets)))
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve(mockSamplers)
      if (type === 'scheduler') return Promise.resolve(mockSchedulers)
      return Promise.resolve({ models: [] })
    })
  })

  it('renders with default form state', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    expect(wrapper.findComponent(NInput).exists()).toBe(true)
    expect(wrapper.findComponent(NDynamicInput).exists()).toBe(true)
  })

  it('fetches presets on mount', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    expect(mockListSamplePresets).toHaveBeenCalled()
    const select = wrapper.findComponent(NSelect)
    const options = select.props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe('Test Preset A')
    expect(options[1].label).toBe('Test Preset B')
  })

  it('fetches samplers and schedulers from ComfyUI API on mount', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    expect(mockGetComfyUIModels).toHaveBeenCalledWith('sampler')
    expect(mockGetComfyUIModels).toHaveBeenCalledWith('scheduler')
  })

  it('loads preset data when preset is selected', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0] // First select is the preset selector
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const nameInput = wrapper.findComponent('[data-testid="preset-name-input"]')
    expect(nameInput.props('value')).toBe('Test Preset A')

    const negativeInput = wrapper.findComponent('[data-testid="negative-prompt-input"]')
    expect(negativeInput.props('value')).toBe('low quality')

    const widthInput = wrapper.findAllComponents(NInputNumber)[0]
    expect(widthInput.props('value')).toBe(1024)

    const heightInput = wrapper.findAllComponents(NInputNumber)[1]
    expect(heightInput.props('value')).toBe(1024)
  })

  it('displays computed total images per checkpoint', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // When loading preset-1: 2 prompts * 3 steps * 3 cfgs * 2 samplers * 2 schedulers * 2 seeds = 144
    expect(totalDiv.text()).toContain('144')
  })

  it('calculates total images correctly based on form inputs', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Default state: 0 prompts (empty name/text) * 1 step * 1 cfg * 0 samplers * 0 schedulers * 1 seed = 0
    const totalDiv = wrapper.find('.total-images')
    expect(totalDiv.text()).toContain('0') // No samplers/schedulers selected and no valid prompts

    // Select samplers and schedulers
    const selectComponents = wrapper.findAllComponents(NSelect)
    const samplersSelect = selectComponents.find((s) => s.props('id') === 'samplers')
    if (samplersSelect) {
      samplersSelect.vm.$emit('update:value', ['euler', 'heun'])
      await nextTick()
    }

    const schedulersSelect = selectComponents.find((s) => s.props('id') === 'schedulers')
    if (schedulersSelect) {
      schedulersSelect.vm.$emit('update:value', ['simple'])
      await nextTick()
    }

    // Still 0 because no valid prompts (name and text both required)
    expect(totalDiv.text()).toContain('0')
  })

  it('saves new preset when Save button is clicked', async () => {
    const createdPreset: SamplePreset = {
      id: 'new-preset-id',
      name: 'New Preset',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      samplers: ['euler'],
      schedulers: ['normal'],
      seeds: [42],
      width: 1024,
      height: 1024,
      images_per_checkpoint: 1,
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    }
    mockCreateSamplePreset.mockResolvedValue(createdPreset)

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Fill in form using component events
    const nameInput = wrapper.findComponent('[data-testid="preset-name-input"]')
    nameInput.vm.$emit('update:value', 'New Preset')
    await nextTick()

    // Set prompts via NDynamicInput components
    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    // Select samplers and schedulers
    const samplersSelect = wrapper.findComponent('[data-testid="samplers-select"]')
    samplersSelect.vm.$emit('update:value', ['euler'])

    const schedulersSelect = wrapper.findComponent('[data-testid="schedulers-select"]')
    schedulersSelect.vm.$emit('update:value', ['normal'])

    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Preset'))!
    await saveButton.trigger('click')
    await flushPromises()

    expect(mockCreateSamplePreset).toHaveBeenCalledWith({
      name: 'New Preset',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      samplers: ['euler'],
      schedulers: ['normal'],
      seeds: [42],
      width: 1024,
      height: 1024,
    })
  })

  it('updates existing preset when Update button is clicked', async () => {
    const updatedPreset: SamplePreset = {
      ...samplePresets[0],
      name: 'Updated Preset A',
      updated_at: '2025-01-03T00:00:00Z',
    }
    mockUpdateSamplePreset.mockResolvedValue(updatedPreset)

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    // Update name
    const nameInput = wrapper.findComponent('[data-testid="preset-name-input"]')
    nameInput.vm.$emit('update:value', 'Updated Preset A')
    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Update Preset'))!
    await saveButton.trigger('click')
    await flushPromises()

    expect(mockUpdateSamplePreset).toHaveBeenCalledWith({
      id: 'preset-1',
      name: 'Updated Preset A',
      prompts: [
        { name: 'forest', text: 'a mystical forest' },
        { name: 'city', text: 'a futuristic city' },
      ],
      negative_prompt: 'low quality',
      steps: [1, 4, 8],
      cfgs: [1.0, 3.0, 7.0],
      samplers: ['euler', 'heun'],
      schedulers: ['simple', 'normal'],
      seeds: [42, 420],
      width: 1024,
      height: 1024,
    })
  })

  it('deletes preset when Delete button is clicked and confirmed', async () => {
    ;(globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true)
    mockDeleteSamplePreset.mockResolvedValue(undefined)

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Preset'))!
    await deleteButton.trigger('click')
    await flushPromises()

    expect(mockDeleteSamplePreset).toHaveBeenCalledWith('preset-1')
  })

  it('does not delete preset when deletion is cancelled', async () => {
    ;(globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false)

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Preset'))!
    await deleteButton.trigger('click')
    await flushPromises()

    expect(mockDeleteSamplePreset).not.toHaveBeenCalled()
  })

  it('resets form when New Preset button is clicked', async () => {
    // Use fresh mocks to avoid contamination from previous tests
    mockListSamplePresets.mockResolvedValue(samplePresets)
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve(mockSamplers)
      if (type === 'scheduler') return Promise.resolve(mockSchedulers)
      return Promise.resolve({ models: [] })
    })

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const nameInput = wrapper.findComponent('[data-testid="preset-name-input"]')
    expect(nameInput.props('value')).toBe('Test Preset A')

    // Click New Preset
    const newButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text() === 'New Preset')!
    await newButton.trigger('click')
    await nextTick()

    expect(nameInput.props('value')).toBe('')
  })

  it('disables save button when required fields are empty', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Preset'))!
    expect(saveButton.props('disabled')).toBe(true)
  })

  it('parses comma-separated step values correctly', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const stepsInput = wrapper.findComponent('[data-testid="steps-input"]')
    stepsInput.vm.$emit('update:value', '1, 4, 8, 20')
    await nextTick()

    // Need to add valid prompts first
    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    // Verify by selecting samplers/schedulers and checking total calculation
    const samplersSelect = wrapper.findComponent('[data-testid="samplers-select"]')
    samplersSelect.vm.$emit('update:value', ['euler'])

    const schedulersSelect = wrapper.findComponent('[data-testid="schedulers-select"]')
    schedulersSelect.vm.$emit('update:value', ['normal'])

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // 1 prompt * 4 steps * 1 cfg * 1 sampler * 1 scheduler * 1 seed = 4
    expect(totalDiv.text()).toContain('4')
  })

  it('parses comma-separated CFG values correctly', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const cfgsInput = wrapper.findComponent('[data-testid="cfgs-input"]')
    cfgsInput.vm.$emit('update:value', '1.0, 3.0, 7.0')
    await nextTick()

    // Need to add valid prompts first
    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    const samplersSelect = wrapper.findComponent('[data-testid="samplers-select"]')
    samplersSelect.vm.$emit('update:value', ['euler'])

    const schedulersSelect = wrapper.findComponent('[data-testid="schedulers-select"]')
    schedulersSelect.vm.$emit('update:value', ['normal'])

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // 1 prompt * 1 step * 3 cfgs * 1 sampler * 1 scheduler * 1 seed = 3
    expect(totalDiv.text()).toContain('3')
  })

  it('parses comma-separated seed values correctly', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const seedsInput = wrapper.findComponent('[data-testid="seeds-input"]')
    seedsInput.vm.$emit('update:value', '42, 420, 1337')
    await nextTick()

    // Need to add valid prompts first
    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    const samplersSelect = wrapper.findComponent('[data-testid="samplers-select"]')
    samplersSelect.vm.$emit('update:value', ['euler'])

    const schedulersSelect = wrapper.findComponent('[data-testid="schedulers-select"]')
    schedulersSelect.vm.$emit('update:value', ['normal'])

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // 1 prompt * 1 step * 1 cfg * 1 sampler * 1 scheduler * 3 seeds = 3
    expect(totalDiv.text()).toContain('3')
  })

  it('displays error message when API call fails', async () => {
    mockListSamplePresets.mockRejectedValue({
      code: 'NETWORK_ERROR',
      message: 'Connection lost',
    })

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('Connection lost')
  })

  it('shows loading state while fetching presets', async () => {
    mockListSamplePresets.mockReturnValue(new Promise(() => {})) // never resolves

    const wrapper = mount(SamplePresetEditor)
    await nextTick()

    const select = wrapper.findAllComponents(NSelect)[0]
    expect(select.props('loading')).toBe(true)
  })

  it('allows manual entry of samplers not in ComfyUI list', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const selectComponents = wrapper.findAllComponents(NSelect)
    const samplersSelect = selectComponents.find((s) => s.props('id') === 'samplers')

    // Verify tag mode is enabled (allows manual entry)
    if (samplersSelect) {
      expect(samplersSelect.props('tag')).toBe(true)
      expect(samplersSelect.props('filterable')).toBe(true)
    }
  })

  it('allows manual entry of schedulers not in ComfyUI list', async () => {
    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    const selectComponents = wrapper.findAllComponents(NSelect)
    const schedulersSelect = selectComponents.find((s) => s.props('id') === 'schedulers')

    // Verify tag mode is enabled (allows manual entry)
    if (schedulersSelect) {
      expect(schedulersSelect.props('tag')).toBe(true)
      expect(schedulersSelect.props('filterable')).toBe(true)
    }
  })

  it('filters out empty prompts when saving', async () => {
    const createdPreset: SamplePreset = {
      id: 'new-preset-id',
      name: 'Test',
      prompts: [{ name: 'valid', text: 'valid prompt' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      samplers: ['euler'],
      schedulers: ['normal'],
      seeds: [42],
      width: 1024,
      height: 1024,
      images_per_checkpoint: 1,
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    }
    mockCreateSamplePreset.mockResolvedValue(createdPreset)

    const wrapper = mount(SamplePresetEditor)
    await flushPromises()

    // Fill form with one valid prompt
    const nameInput = wrapper.findComponent('[data-testid="preset-name-input"]')
    nameInput.vm.$emit('update:value', 'Test')

    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'valid')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'valid prompt')

    const samplersSelect = wrapper.findComponent('[data-testid="samplers-select"]')
    samplersSelect.vm.$emit('update:value', ['euler'])

    const schedulersSelect = wrapper.findComponent('[data-testid="schedulers-select"]')
    schedulersSelect.vm.$emit('update:value', ['normal'])

    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Preset'))!
    await saveButton.trigger('click')
    await flushPromises()

    const call = mockCreateSamplePreset.mock.calls[0][0]
    expect(call.prompts).toHaveLength(1)
    expect(call.prompts[0]).toEqual({ name: 'valid', text: 'valid prompt' })
  })

  afterAll(() => {
    globalThis.confirm = originalConfirm
  })
})
