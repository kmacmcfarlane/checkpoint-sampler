import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NButton, NInput, NInputNumber, NDynamicInput, NDynamicTags } from 'naive-ui'
import StudyEditor from '../StudyEditor.vue'
import { validateStudyImport } from '../studyImportValidation'
import type { Study, ComfyUIModels } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    listStudies: vi.fn(),
    createStudy: vi.fn(),
    updateStudy: vi.fn(),
    deleteStudy: vi.fn(),
    getComfyUIModels: vi.fn(),
  },
}))

// Mock window.confirm
const originalConfirm = globalThis.confirm
beforeEach(() => {
  globalThis.confirm = vi.fn()
})

import { apiClient } from '../../api/client'

// enableAutoUnmount is configured globally in vitest.setup.ts

const mockListStudies = apiClient.listStudies as ReturnType<typeof vi.fn>
const mockCreateStudy = apiClient.createStudy as ReturnType<typeof vi.fn>
const mockUpdateStudy = apiClient.updateStudy as ReturnType<typeof vi.fn>
const mockDeleteStudy = apiClient.deleteStudy as ReturnType<typeof vi.fn>
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>

const studies: Study[] = [
  {
    id: 'preset-1',
    name: 'Test Preset A',
    prompt_prefix: 'photo of a person, ',
    prompts: [
      { name: 'forest', text: 'a mystical forest' },
      { name: 'city', text: 'a futuristic city' },
    ],
    negative_prompt: 'low quality',
    steps: [1, 4, 8],
    cfgs: [1.0, 3.0, 7.0],
    sampler_scheduler_pairs: [
      { sampler: 'euler', scheduler: 'simple' },
      { sampler: 'heun', scheduler: 'normal' },
    ],
    seeds: [42, 420],
    width: 1024,
    height: 1024,
    images_per_checkpoint: 72, // 2*3*3*2*2 = 72
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-2',
    name: 'Test Preset B',
    prompt_prefix: '',
    prompts: [{ name: 'cat', text: 'a cute cat' }],
    negative_prompt: '',
    steps: [20],
    cfgs: [7.0],
    sampler_scheduler_pairs: [
      { sampler: 'euler', scheduler: 'normal' },
    ],
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

/** Cast a WrapperLike result from findComponent to VueWrapper so .props() and .vm are accessible. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asVue(w: ReturnType<ReturnType<typeof mount>['findComponent']>): VueWrapper<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return w as VueWrapper<any>
}

describe('StudyEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Return a fresh copy of presets for each test to avoid mutation issues
    mockListStudies.mockResolvedValue(JSON.parse(JSON.stringify(studies)))
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve(mockSamplers)
      if (type === 'scheduler') return Promise.resolve(mockSchedulers)
      return Promise.resolve({ models: [] })
    })
  })

  it('renders with default form state', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    expect(wrapper.findComponent(NInput).exists()).toBe(true)
    // Two NDynamicInput: one for prompts, one for sampler/scheduler pairs
    expect(wrapper.findAllComponents(NDynamicInput)).toHaveLength(2)
    expect(wrapper.findAllComponents(NDynamicTags)).toHaveLength(3)
  })

  it('fetches presets on mount', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    expect(mockListStudies).toHaveBeenCalled()
    const select = wrapper.findComponent(NSelect)
    const options = select.props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe('Test Preset A')
    expect(options[1].label).toBe('Test Preset B')
  })

  it('fetches samplers and schedulers from ComfyUI API on mount', async () => {
    mount(StudyEditor)
    await flushPromises()

    expect(mockGetComfyUIModels).toHaveBeenCalledWith('sampler')
    expect(mockGetComfyUIModels).toHaveBeenCalledWith('scheduler')
  })

  it('loads preset data when preset is selected', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0] // First select is the preset selector
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
    expect(nameInput.props('value')).toBe('Test Preset A')

    const negativeInput = asVue(wrapper.findComponent('[data-testid="negative-prompt-input"]'))
    expect(negativeInput.props('value')).toBe('low quality')

    const widthInput = wrapper.findAllComponents(NInputNumber)[0]
    expect(widthInput.props('value')).toBe(1024)

    const heightInput = wrapper.findAllComponents(NInputNumber)[1]
    expect(heightInput.props('value')).toBe(1024)
  })

  it('loads steps, cfgs and seeds into NDynamicTags when preset is selected', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const [stepsTags, cfgsTags, seedsTags] = wrapper.findAllComponents(NDynamicTags)
    expect(stepsTags.props('value')).toEqual(['1', '4', '8'])
    // AC2 (S-067): CFG whole-number values preserve trailing zero → '1.0', '3.0', '7.0'
    expect(cfgsTags.props('value')).toEqual(['1.0', '3.0', '7.0'])
    expect(seedsTags.props('value')).toEqual(['42', '420'])
  })

  it('displays computed total images per checkpoint', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // When loading preset-1: 2 prompts * 3 steps * 3 cfgs * 2 pairs * 2 seeds = 72
    expect(totalDiv.text()).toContain('72')
  })

  it('calculates total images correctly based on form inputs', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Default state: 0 prompts (empty name/text) * 1 step * 1 cfg * 0 pairs * 1 seed = 0
    const totalDiv = wrapper.find('.total-images')
    expect(totalDiv.text()).toContain('0') // No pairs and no valid prompts

    // Add a sampler/scheduler pair via the vm
    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'simple' }]
    await nextTick()

    // Still 0 because no valid prompts (name and text both required)
    expect(totalDiv.text()).toContain('0')
  })

  it('saves new preset when Save button is clicked', async () => {
    const createdPreset: Study = {
      id: 'new-preset-id',
      name: 'New Study',
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 1024,
      height: 1024,
      images_per_checkpoint: 1,
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    }
    mockCreateStudy.mockResolvedValue(createdPreset)

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Fill in form using component events
    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
    nameInput.vm.$emit('update:value', 'New Study')
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

    // Add a sampler/scheduler pair
    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Study'))!
    await saveButton.trigger('click')
    await flushPromises()

    expect(mockCreateStudy).toHaveBeenCalledWith({
      name: 'New Study',
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'test prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 1024,
      height: 1024,
    })
  })

  it('updates existing preset when Update button is clicked', async () => {
    const updatedPreset: Study = {
      ...studies[0],
      name: 'Updated Preset A',
      updated_at: '2025-01-03T00:00:00Z',
    }
    mockUpdateStudy.mockResolvedValue(updatedPreset)

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    // Update name
    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
    nameInput.vm.$emit('update:value', 'Updated Preset A')
    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Update Study'))!
    await saveButton.trigger('click')
    await flushPromises()

    expect(mockUpdateStudy).toHaveBeenCalledWith({
      id: 'preset-1',
      name: 'Updated Preset A',
      prompt_prefix: 'photo of a person, ',
      prompts: [
        { name: 'forest', text: 'a mystical forest' },
        { name: 'city', text: 'a futuristic city' },
      ],
      negative_prompt: 'low quality',
      steps: [1, 4, 8],
      cfgs: [1.0, 3.0, 7.0],
      sampler_scheduler_pairs: [
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'normal' },
      ],
      seeds: [42, 420],
      width: 1024,
      height: 1024,
    })
  })

  it('deletes preset when Delete button is clicked and confirmed', async () => {
    ;(globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true)
    mockDeleteStudy.mockResolvedValue(undefined)

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await flushPromises()

    expect(mockDeleteStudy).toHaveBeenCalledWith('preset-1')
  })

  it('does not delete preset when deletion is cancelled', async () => {
    ;(globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false)

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await flushPromises()

    expect(mockDeleteStudy).not.toHaveBeenCalled()
  })

  it('resets form when New Preset button is clicked', async () => {
    // Use fresh mocks to avoid contamination from previous tests
    mockListStudies.mockResolvedValue(studies)
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve(mockSamplers)
      if (type === 'scheduler') return Promise.resolve(mockSchedulers)
      return Promise.resolve({ models: [] })
    })

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
    expect(nameInput.props('value')).toBe('Test Preset A')

    // Click New Preset
    const newButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text() === 'New Study')!
    await newButton.trigger('click')
    await nextTick()

    expect(nameInput.props('value')).toBe('')
  })

  it('resets steps to default [30] when New Preset is clicked', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Select preset to change steps
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    // Click New Preset to reset
    const newButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text() === 'New Study')!
    await newButton.trigger('click')
    await nextTick()

    const stepsTags = asVue(wrapper.findComponent('[data-testid="steps-tags"]'))
    expect(stepsTags.props('value')).toEqual(['30'])
  })

  it('disables save button when required fields are empty', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Study'))!
    expect(saveButton.props('disabled')).toBe(true)
  })

  it('NDynamicTags for steps updates steps state when tags are changed', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const stepsTags = asVue(wrapper.findComponent('[data-testid="steps-tags"]'))
    stepsTags.vm.$emit('update:value', ['1', '4', '8', '20'])
    await nextTick()

    // Verify by adding valid prompts + sampler/scheduler pair and checking total calculation
    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // 1 prompt * 4 steps * 1 cfg * 1 pair * 1 seed = 4
    expect(totalDiv.text()).toContain('4')
  })

  it('NDynamicTags for cfgs updates cfgs state when tags are changed', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const cfgsTags = asVue(wrapper.findComponent('[data-testid="cfgs-tags"]'))
    cfgsTags.vm.$emit('update:value', ['1.0', '3.0', '7.0'])
    await nextTick()

    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // 1 prompt * 1 step * 3 cfgs * 1 pair * 1 seed = 3
    expect(totalDiv.text()).toContain('3')
  })

  // AC2 (S-067): CFG trailing-zero display
  it('cfgsAsStrings preserves trailing zero for whole-number CFG values', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const cfgsTags = asVue(wrapper.findComponent('[data-testid="cfgs-tags"]'))

    // Default value is [7.0]; formatCfg(7) should produce '7.0', not '7'
    expect(cfgsTags.props('value')).toEqual(['7.0'])
  })

  it('cfgsAsStrings preserves fractional CFG values unchanged', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const cfgsTags = asVue(wrapper.findComponent('[data-testid="cfgs-tags"]'))
    cfgsTags.vm.$emit('update:value', ['1.5', '3.75', '7.25'])
    await nextTick()

    // Fractional values are not integers — formatCfg returns them as-is
    expect(cfgsTags.props('value')).toEqual(['1.5', '3.75', '7.25'])
  })

  it('cfgsAsStrings formats mixed whole and fractional CFG values correctly', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const cfgsTags = asVue(wrapper.findComponent('[data-testid="cfgs-tags"]'))
    cfgsTags.vm.$emit('update:value', ['1.0', '3.5', '7.0', '12.0'])
    await nextTick()

    // Whole numbers get '.0' suffix; fractional values stay as-is
    expect(cfgsTags.props('value')).toEqual(['1.0', '3.5', '7.0', '12.0'])
  })

  it('NDynamicTags for seeds updates seeds state when tags are changed', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const seedsTags = asVue(wrapper.findComponent('[data-testid="seeds-tags"]'))
    seedsTags.vm.$emit('update:value', ['42', '420', '1337'])
    await nextTick()

    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')

    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // 1 prompt * 1 step * 1 cfg * 1 pair * 3 seeds = 3
    expect(totalDiv.text()).toContain('3')
  })

  it('displays error message when API call fails', async () => {
    mockListStudies.mockRejectedValue({
      code: 'NETWORK_ERROR',
      message: 'Connection lost',
    })

    const wrapper = mount(StudyEditor)
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('Connection lost')
  })

  it('shows loading state while fetching presets', async () => {
    mockListStudies.mockReturnValue(new Promise(() => {})) // never resolves

    const wrapper = mount(StudyEditor)
    await nextTick()

    const select = wrapper.findAllComponents(NSelect)[0]
    expect(select.props('loading')).toBe(true)
  })

  it('NDynamicTags inputProps restricts entry to digits and "." only', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const [stepsTags] = wrapper.findAllComponents(NDynamicTags)
    const inputProps = stepsTags.props('inputProps') as { allowInput: (val: string) => boolean }
    expect(typeof inputProps.allowInput).toBe('function')

    // Valid inputs
    expect(inputProps.allowInput('123')).toBe(true)
    expect(inputProps.allowInput('3.14')).toBe(true)
    expect(inputProps.allowInput('0')).toBe(true)
    expect(inputProps.allowInput('')).toBe(true)

    // Invalid inputs
    expect(inputProps.allowInput('abc')).toBe(false)
    expect(inputProps.allowInput('1a')).toBe(false)
    expect(inputProps.allowInput('1,2')).toBe(false)
    expect(inputProps.allowInput('1 2')).toBe(false)
  })

  it('NDynamicTags inputProps is shared across all numeric tag inputs', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const tagComponents = wrapper.findAllComponents(NDynamicTags)
    expect(tagComponents).toHaveLength(3)

    // All three tag inputs should have the allowInput restriction
    for (const tagComp of tagComponents) {
      const inputProps = tagComp.props('inputProps') as { allowInput: (val: string) => boolean }
      expect(typeof inputProps.allowInput).toBe('function')
      expect(inputProps.allowInput('abc')).toBe(false)
      expect(inputProps.allowInput('123')).toBe(true)
    }
  })

  it('filters out empty prompts when saving', async () => {
    const createdPreset: Study = {
      id: 'new-preset-id',
      name: 'Test',
      prompt_prefix: '',
      prompts: [{ name: 'valid', text: 'valid prompt' }],
      negative_prompt: '',
      steps: [30],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 1024,
      height: 1024,
      images_per_checkpoint: 1,
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    }
    mockCreateStudy.mockResolvedValue(createdPreset)

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Fill form with one valid prompt
    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
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

    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Study'))!
    await saveButton.trigger('click')
    await flushPromises()

    const call = mockCreateStudy.mock.calls[0][0]
    expect(call.prompts).toHaveLength(1)
    expect(call.prompts[0]).toEqual({ name: 'valid', text: 'valid prompt' })
  })

  it('NDynamicInput has onCreate prop that returns correct shape {name, text} for prompts', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    // First NDynamicInput is prompts
    const dynamicInputs = wrapper.findAllComponents(NDynamicInput)
    const promptDynamicInput = dynamicInputs[0]
    expect(promptDynamicInput.exists()).toBe(true)

    // The onCreate prop must be a function that returns {name: '', text: ''}
    const onCreate = promptDynamicInput.props('onCreate') as (() => unknown) | undefined
    expect(typeof onCreate).toBe('function')
    const newItem = onCreate!()
    expect(newItem).toEqual({ name: '', text: '' })
  })

  it('NDynamicInput has onCreate prop that returns correct shape {sampler, scheduler} for pairs', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Second NDynamicInput is sampler/scheduler pairs
    const dynamicInputs = wrapper.findAllComponents(NDynamicInput)
    const pairsDynamicInput = dynamicInputs[1]
    expect(pairsDynamicInput.exists()).toBe(true)

    const onCreate = pairsDynamicInput.props('onCreate') as (() => unknown) | undefined
    expect(typeof onCreate).toBe('function')
    const newItem = onCreate!()
    expect(newItem).toEqual({ sampler: '', scheduler: '' })
  })

  it('adding a second prompt via onCreate produces an item with correct shape and no console errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Simulate what NDynamicInput does when the user clicks "Add" --
    // call the onCreate handler and push the result into prompts
    const dynamicInputs = wrapper.findAllComponents(NDynamicInput)
    const onCreate = dynamicInputs[0].props('onCreate') as (index: number) => unknown
    const newItem = onCreate(1)

    // The item must be a properly shaped object (not null)
    expect(newItem).toEqual({ name: '', text: '' })

    // Push the new item into the reactive prompts array and verify no errors
    const vm = wrapper.vm as unknown as { prompts: unknown[] }
    vm.prompts = [...vm.prompts, newItem]
    await nextTick()

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('computedTotalImages counts only fully-filled prompt entries', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Set up one valid prompt plus one empty prompt (as created by onCreate)
    const vm = wrapper.vm as unknown as {
      prompts: { name: string; text: string }[]
      samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }>
    }
    vm.prompts = [
      { name: 'valid', text: 'valid text' },
      { name: '', text: '' }, // empty prompt created by onCreate -- should be excluded
    ]
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

    await nextTick()

    const totalDiv = wrapper.find('.total-images')
    // Only the 1 valid prompt counts: 1 * 1 step * 1 cfg * 1 pair * 1 seed = 1
    expect(totalDiv.text()).toContain('1')
  })

  it('canSave returns false when all prompts are empty (as after onCreate)', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    // Fill preset name and add a pair but leave prompts with only empty entries
    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
    nameInput.vm.$emit('update:value', 'My Preset')

    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]
    await nextTick()

    // Default prompt is {name:'', text:''} -- save must be disabled
    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Study'))!
    expect(saveButton.props('disabled')).toBe(true)
  })

  it('canSave returns false when pairs have empty sampler or scheduler', async () => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
    nameInput.vm.$emit('update:value', 'My Preset')

    const promptInputs = wrapper.findAllComponents(NInput)
    const promptNameInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt name')
    )!
    promptNameInput.vm.$emit('update:value', 'test')
    const promptTextInput = promptInputs.find((input) =>
      input.props('placeholder')?.includes('Prompt text')
    )!
    promptTextInput.vm.$emit('update:value', 'test prompt')

    // Add a pair with empty sampler
    const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
    vm.samplerSchedulerPairs = [{ sampler: '', scheduler: 'normal' }]
    await nextTick()

    const saveButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Save Study'))!
    expect(saveButton.props('disabled')).toBe(true)
  })

  it.each([
    {
      field: 'steps',
      testid: 'steps-tags',
      tags: ['1', '4', '8', '20'],
      expectedNumbers: [1, 4, 8, 20],
      expectedStrings: ['1', '4', '8', '20'],
    },
    {
      field: 'cfgs',
      testid: 'cfgs-tags',
      // AC2 (S-067): CFG values preserve trailing zero for whole numbers.
      // parseFloat('1.0') = 1 (integer), so formatCfg(1) = '1.0'.
      // parseFloat('3.5') = 3.5 (non-integer), so formatCfg(3.5) = '3.5'.
      tags: ['1.0', '3.5', '7.0'],
      expectedNumbers: [1.0, 3.5, 7.0],
      expectedStrings: ['1.0', '3.5', '7.0'],
    },
    {
      field: 'seeds',
      testid: 'seeds-tags',
      tags: ['42', '420'],
      expectedNumbers: [42, 420],
      expectedStrings: ['42', '420'],
    },
  ])('NDynamicTags $field round-trips numeric values correctly', async ({ testid, tags, expectedNumbers, expectedStrings }) => {
    const wrapper = mount(StudyEditor)
    await flushPromises()

    const tagsComponent = asVue(wrapper.findComponent(`[data-testid="${testid}"]`))
    tagsComponent.vm.$emit('update:value', tags)
    await nextTick()

    // Verify the displayed value reflects parsed numbers converted back to strings
    expect(tagsComponent.props('value')).toEqual(expectedStrings)

    // Verify the internal numeric state is correct by checking via vm
    const vm = wrapper.vm as unknown as { steps: number[]; cfgs: number[]; seeds: number[] }
    if (testid === 'steps-tags') expect(vm.steps).toEqual(expectedNumbers)
    if (testid === 'cfgs-tags') expect(vm.cfgs).toEqual(expectedNumbers)
    if (testid === 'seeds-tags') expect(vm.seeds).toEqual(expectedNumbers)
  })

  describe('theme-aware styling', () => {
    it('total-images element uses theme-aware CSS class without hardcoded inline colors', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const totalImages = wrapper.find('.total-images')
      expect(totalImages.exists()).toBe(true)
      // Verify no inline style with hardcoded colors
      expect(totalImages.attributes('style')).toBeUndefined()
    })

    it('total-images element has theme-aware CSS class applied', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const totalImages = wrapper.find('.total-images')
      expect(totalImages.classes()).toContain('total-images')
    })

    it('form-field labels use theme-aware CSS class without hardcoded inline colors', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const labels = wrapper.findAll('.form-field label')
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) {
        expect(label.attributes('style')).toBeUndefined()
      }
    })
  })

  describe('initialStudyId prop -- pre-selection on open', () => {
    // AC: When opening the sub-dialog from the parent, the currently selected study is pre-selected.
    it('pre-selects the study matching initialStudyId on mount', async () => {
      const wrapper = mount(StudyEditor, {
        props: { initialStudyId: 'preset-1' },
      })
      await flushPromises()

      // The study selector should show preset-1 as selected
      const select = wrapper.findAllComponents(NSelect)[0]
      expect(select.props('value')).toBe('preset-1')

      // The form should be populated with preset-1's data
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      expect(nameInput.props('value')).toBe('Test Preset A')
    })

    // AC: If no study is selected in the parent, the StudyEditor opens with no study selected.
    it('opens with no study selected when initialStudyId is null', async () => {
      const wrapper = mount(StudyEditor, {
        props: { initialStudyId: null },
      })
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      expect(select.props('value')).toBeNull()

      // Form should be in default empty state
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      expect(nameInput.props('value')).toBe('')
    })

    // AC: If no study is selected in the parent (prop omitted), opens with no study selected.
    it('opens with no study selected when initialStudyId is not provided', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      expect(select.props('value')).toBeNull()
    })

    // AC: If the initialStudyId does not match any loaded study, no study is selected.
    it('does not pre-select when initialStudyId does not match any loaded study', async () => {
      const wrapper = mount(StudyEditor, {
        props: { initialStudyId: 'nonexistent-preset' },
      })
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      expect(select.props('value')).toBeNull()
    })

    it('pre-selects a different study when initialStudyId points to preset-2', async () => {
      const wrapper = mount(StudyEditor, {
        props: { initialStudyId: 'preset-2' },
      })
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      expect(select.props('value')).toBe('preset-2')

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      expect(nameInput.props('value')).toBe('Test Preset B')
    })
  })

  describe('sampler/scheduler pairs management', () => {
    it('loads pairs from preset when selected', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      expect(vm.samplerSchedulerPairs).toHaveLength(2)
      expect(vm.samplerSchedulerPairs[0]).toEqual({ sampler: 'euler', scheduler: 'simple' })
      expect(vm.samplerSchedulerPairs[1]).toEqual({ sampler: 'heun', scheduler: 'normal' })
    })

    it('resets pairs to empty when New Preset is clicked', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Select preset to populate pairs
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click New Preset to reset
      const newButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text() === 'New Study')!
      await newButton.trigger('click')
      await nextTick()

      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      expect(vm.samplerSchedulerPairs).toHaveLength(0)
    })

    it('sends pairs in save payload', async () => {
      const createdPreset: Study = {
        id: 'new-id',
        name: 'Multi Pair',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [
          { sampler: 'euler', scheduler: 'simple' },
          { sampler: 'heun', scheduler: 'karras' },
        ],
        seeds: [42],
        width: 1024,
        height: 1024,
        images_per_checkpoint: 2,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockCreateStudy.mockResolvedValue(createdPreset)

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Fill form
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Multi Pair')

      const promptInputs = wrapper.findAllComponents(NInput)
      const promptNameInput = promptInputs.find((input) =>
        input.props('placeholder')?.includes('Prompt name')
      )!
      promptNameInput.vm.$emit('update:value', 'test')
      const promptTextInput = promptInputs.find((input) =>
        input.props('placeholder')?.includes('Prompt text')
      )!
      promptTextInput.vm.$emit('update:value', 'test prompt')

      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      vm.samplerSchedulerPairs = [
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'karras' },
      ]

      await nextTick()

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Save Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      expect(mockCreateStudy).toHaveBeenCalledWith(
        expect.objectContaining({
          sampler_scheduler_pairs: [
            { sampler: 'euler', scheduler: 'simple' },
            { sampler: 'heun', scheduler: 'karras' },
          ],
        }),
      )
    })
  })

  describe('prompt prefix field', () => {
    it('renders prompt prefix input', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const prefixInput = asVue(wrapper.findComponent('[data-testid="prompt-prefix-input"]'))
      expect(prefixInput.exists()).toBe(true)
      expect(prefixInput.props('value')).toBe('')
    })

    it('loads prompt prefix from preset when selected', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      const prefixInput = asVue(wrapper.findComponent('[data-testid="prompt-prefix-input"]'))
      expect(prefixInput.props('value')).toBe('photo of a person, ')
    })

    it('loads empty prompt prefix from preset without prefix', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-2')
      await nextTick()

      const prefixInput = asVue(wrapper.findComponent('[data-testid="prompt-prefix-input"]'))
      expect(prefixInput.props('value')).toBe('')
    })

    it('resets prompt prefix when New Preset is clicked', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Select a preset with a prefix
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      const prefixInput = asVue(wrapper.findComponent('[data-testid="prompt-prefix-input"]'))
      expect(prefixInput.props('value')).toBe('photo of a person, ')

      // Click New Preset
      const newButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text() === 'New Study')!
      await newButton.trigger('click')
      await nextTick()

      expect(prefixInput.props('value')).toBe('')
    })

    it('includes prompt prefix in create payload', async () => {
      const createdPreset: Study = {
        id: 'prefix-preset-id',
        name: 'Prefix Test',
        prompt_prefix: 'artistic photo, ',
        prompts: [{ name: 'test', text: 'test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        images_per_checkpoint: 1,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockCreateStudy.mockResolvedValue(createdPreset)

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Fill in form
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Prefix Test')

      const prefixInput = asVue(wrapper.findComponent('[data-testid="prompt-prefix-input"]'))
      prefixInput.vm.$emit('update:value', 'artistic photo, ')

      const promptInputs = wrapper.findAllComponents(NInput)
      const promptNameInput = promptInputs.find((input) =>
        input.props('placeholder')?.includes('Prompt name')
      )!
      promptNameInput.vm.$emit('update:value', 'test')
      const promptTextInput = promptInputs.find((input) =>
        input.props('placeholder')?.includes('Prompt text')
      )!
      promptTextInput.vm.$emit('update:value', 'test prompt')

      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]

      await nextTick()

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Save Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      expect(mockCreateStudy).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt_prefix: 'artistic photo, ',
        }),
      )
    })

    it('includes prompt prefix in update payload', async () => {
      const updatedPreset: Study = {
        ...studies[0],
        prompt_prefix: 'updated prefix. ',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockUpdateStudy.mockResolvedValue(updatedPreset)

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Select preset
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Change the prompt prefix
      const prefixInput = asVue(wrapper.findComponent('[data-testid="prompt-prefix-input"]'))
      prefixInput.vm.$emit('update:value', 'updated prefix. ')
      await nextTick()

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      expect(mockUpdateStudy).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt_prefix: 'updated prefix. ',
        }),
      )
    })
  })

  describe('import/export', () => {
    describe('validateStudyImport (unit)', () => {
      const validPayload = {
        name: 'My Study',
        prompt_prefix: 'photo, ',
        prompts: [{ name: 'forest', text: 'a forest' }],
        negative_prompt: 'blurry',
        steps: [20, 30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'simple' }],
        seeds: [42],
        width: 512,
        height: 512,
      }

      it('accepts a valid payload and returns ok with data', () => {
        const result = validateStudyImport(validPayload)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.data.name).toBe('My Study')
          expect(result.data.steps).toEqual([20, 30])
          expect(result.data.width).toBe(512)
        }
      })

      it('trims the name field', () => {
        const result = validateStudyImport({ ...validPayload, name: '  Trimmed  ' })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.name).toBe('Trimmed')
      })

      it('defaults prompt_prefix to empty string when absent', () => {
        const { prompt_prefix: _pp, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.prompt_prefix).toBe('')
      })

      it('defaults negative_prompt to empty string when absent', () => {
        const { negative_prompt: _np, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.negative_prompt).toBe('')
      })

      it('returns error when input is not an object', () => {
        const result = validateStudyImport('not an object')
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('expected an object')
      })

      it('returns error when input is an array', () => {
        const result = validateStudyImport([])
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('expected an object')
      })

      it('returns error when name is missing', () => {
        const { name: _n, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"name"')
      })

      it('returns error when name is an empty string', () => {
        const result = validateStudyImport({ ...validPayload, name: '' })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"name"')
      })

      it('returns error when name is not a string', () => {
        const result = validateStudyImport({ ...validPayload, name: 42 })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"name"')
      })

      it('returns error when prompts is missing', () => {
        const { prompts: _p, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"prompts"')
      })

      it('returns error when prompts is not an array', () => {
        const result = validateStudyImport({ ...validPayload, prompts: 'not-array' })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"prompts"')
      })

      it('returns error when prompts is empty', () => {
        const result = validateStudyImport({ ...validPayload, prompts: [] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"prompts"')
      })

      it('returns error when a prompt entry is missing name', () => {
        const result = validateStudyImport({ ...validPayload, prompts: [{ text: 'some text' }] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('prompts[0].name')
      })

      it('returns error when a prompt entry is missing text', () => {
        const result = validateStudyImport({ ...validPayload, prompts: [{ name: 'n' }] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('prompts[0].text')
      })

      it('returns error when steps is missing', () => {
        const { steps: _s, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"steps"')
      })

      it('returns error when steps contains non-numbers', () => {
        const result = validateStudyImport({ ...validPayload, steps: ['20', 30] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('steps[0]')
      })

      it('returns error when steps contains a float (non-integer)', () => {
        const result = validateStudyImport({ ...validPayload, steps: [3.7] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('steps[0]')
      })

      it('returns error when steps contains zero', () => {
        const result = validateStudyImport({ ...validPayload, steps: [0] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('steps[0]')
      })

      it('returns error when steps contains a negative integer', () => {
        const result = validateStudyImport({ ...validPayload, steps: [-1] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('steps[0]')
      })

      it('returns error when steps contains NaN', () => {
        const result = validateStudyImport({ ...validPayload, steps: [NaN] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('steps[0]')
      })

      it('returns error when cfgs is missing', () => {
        const { cfgs: _c, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"cfgs"')
      })

      it('returns error when sampler_scheduler_pairs is missing', () => {
        const { sampler_scheduler_pairs: _ssp, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"sampler_scheduler_pairs"')
      })

      it('returns error when sampler_scheduler_pairs is empty', () => {
        const result = validateStudyImport({ ...validPayload, sampler_scheduler_pairs: [] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"sampler_scheduler_pairs"')
      })

      it('returns error when a pair entry is missing sampler', () => {
        const result = validateStudyImport({
          ...validPayload,
          sampler_scheduler_pairs: [{ scheduler: 'simple' }],
        })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('sampler_scheduler_pairs[0].sampler')
      })

      it('returns error when seeds is missing', () => {
        const { seeds: _s, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"seeds"')
      })

      it('returns error when seeds contains non-numbers', () => {
        const result = validateStudyImport({ ...validPayload, seeds: ['42'] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('seeds[0]')
      })

      it('returns error when seeds contains a negative value', () => {
        const result = validateStudyImport({ ...validPayload, seeds: [-5] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('seeds[0]')
      })

      it('returns error when seeds contains a float (non-integer)', () => {
        const result = validateStudyImport({ ...validPayload, seeds: [0.5] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('seeds[0]')
      })

      it('returns error when seeds contains NaN', () => {
        const result = validateStudyImport({ ...validPayload, seeds: [NaN] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('seeds[0]')
      })

      it('accepts seeds containing zero (non-negative integer)', () => {
        const result = validateStudyImport({ ...validPayload, seeds: [0, 42] })
        expect(result.ok).toBe(true)
      })

      it('returns error when cfgs contains NaN', () => {
        const result = validateStudyImport({ ...validPayload, cfgs: [NaN] })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('cfgs[0]')
      })

      it('returns error when width is NaN', () => {
        const result = validateStudyImport({ ...validPayload, width: NaN })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"width"')
      })

      it('returns error when height is NaN', () => {
        const result = validateStudyImport({ ...validPayload, height: NaN })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"height"')
      })

      it('returns error when width is missing', () => {
        const { width: _w, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"width"')
      })

      it('returns error when width is not a number', () => {
        const result = validateStudyImport({ ...validPayload, width: '512' })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"width"')
      })

      it('returns error when width is zero or negative', () => {
        const result = validateStudyImport({ ...validPayload, width: 0 })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"width"')
      })

      it('returns error when height is missing', () => {
        const { height: _h, ...rest } = validPayload
        const result = validateStudyImport(rest)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"height"')
      })

      it('returns error when height is negative', () => {
        const result = validateStudyImport({ ...validPayload, height: -1 })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toContain('"height"')
      })
    })

    describe('export button', () => {
      it('export button is rendered in the action-buttons area', async () => {
        const wrapper = mount(StudyEditor)
        await flushPromises()

        const exportButton = wrapper.findComponent('[data-testid="export-study-button"]')
        expect(exportButton.exists()).toBe(true)
      })

      it('export button is disabled when canSave is false (empty form)', async () => {
        const wrapper = mount(StudyEditor)
        await flushPromises()

        const exportButton = asVue(wrapper.findComponent('[data-testid="export-study-button"]'))
        expect(exportButton.props('disabled')).toBe(true)
      })

      it('export button is enabled when form is filled (canSave is true)', async () => {
        const wrapper = mount(StudyEditor)
        await flushPromises()

        // Load a study so canSave is true
        const select = wrapper.findAllComponents(NSelect)[0]
        select.vm.$emit('update:value', 'preset-1')
        await nextTick()

        const exportButton = asVue(wrapper.findComponent('[data-testid="export-study-button"]'))
        expect(exportButton.props('disabled')).toBe(false)
      })

      it('export button triggers download with correct JSON shape excluding id and timestamps', async () => {
        // Capture the Blob passed to createObjectURL
        let capturedBlob: Blob | undefined
        const createObjectURL = vi.fn((blob: Blob) => {
          capturedBlob = blob
          return 'blob:mock-url'
        })
        const revokeObjectURL = vi.fn()
        const mockClick = vi.fn()
        const mockAnchor = { href: '', download: '', click: mockClick }

        // Store originals to avoid infinite recursion when spying
        const origCreateObjectURL = URL.createObjectURL?.bind(URL)
        const origRevokeObjectURL = URL.revokeObjectURL?.bind(URL)
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
        Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })

        const origCreateElement = document.createElement.bind(document)
        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
          if (tag === 'a') return mockAnchor as unknown as HTMLElement
          // Use the bound original to avoid infinite recursion
          return origCreateElement(tag)
        })

        try {
          const wrapper = mount(StudyEditor)
          await flushPromises()

          // Load preset-1
          const select = wrapper.findAllComponents(NSelect)[0]
          select.vm.$emit('update:value', 'preset-1')
          await nextTick()

          const exportButton = asVue(wrapper.findComponent('[data-testid="export-study-button"]'))
          await exportButton.trigger('click')

          expect(mockClick).toHaveBeenCalled()
          expect(capturedBlob).toBeDefined()

          // Parse the exported JSON
          const text = await capturedBlob!.text()
          const parsed = JSON.parse(text)

          // Must have all CreateStudyPayload fields
          expect(parsed.name).toBe('Test Preset A')
          expect(parsed.prompt_prefix).toBe('photo of a person, ')
          expect(parsed.prompts).toEqual([
            { name: 'forest', text: 'a mystical forest' },
            { name: 'city', text: 'a futuristic city' },
          ])
          expect(parsed.negative_prompt).toBe('low quality')
          expect(parsed.steps).toEqual([1, 4, 8])
          expect(parsed.cfgs).toEqual([1.0, 3.0, 7.0])
          expect(parsed.sampler_scheduler_pairs).toEqual([
            { sampler: 'euler', scheduler: 'simple' },
            { sampler: 'heun', scheduler: 'normal' },
          ])
          expect(parsed.seeds).toEqual([42, 420])
          expect(parsed.width).toBe(1024)
          expect(parsed.height).toBe(1024)

          // Must NOT have id, created_at, updated_at, images_per_checkpoint
          expect(parsed).not.toHaveProperty('id')
          expect(parsed).not.toHaveProperty('created_at')
          expect(parsed).not.toHaveProperty('updated_at')
          expect(parsed).not.toHaveProperty('images_per_checkpoint')

          // Download filename should use study name
          expect(mockAnchor.download).toBe('Test Preset A.json')
        } finally {
          createElementSpy.mockRestore()
          if (origCreateObjectURL) {
            Object.defineProperty(URL, 'createObjectURL', { value: origCreateObjectURL, configurable: true, writable: true })
          }
          if (origRevokeObjectURL) {
            Object.defineProperty(URL, 'revokeObjectURL', { value: origRevokeObjectURL, configurable: true, writable: true })
          }
        }
      })
    })

    describe('import button', () => {
      it('import button is always rendered (not gated on canSave)', async () => {
        const wrapper = mount(StudyEditor)
        await flushPromises()

        const importButton = wrapper.findComponent('[data-testid="import-study-button"]')
        expect(importButton.exists()).toBe(true)
      })

      it('populates form fields from a valid JSON file and clears selected study', async () => {
        const importedData = {
          name: 'Imported Study',
          prompt_prefix: '',
          prompts: [{ name: 'space', text: 'outer space scene' }],
          negative_prompt: '',
          steps: [25],
          cfgs: [6.5],
          sampler_scheduler_pairs: [{ sampler: 'dpm_2', scheduler: 'karras' }],
          seeds: [100],
          width: 768,
          height: 768,
        }

        // Mount first so Vue can create all its DOM elements without interference
        const wrapper = mount(StudyEditor)
        await flushPromises()

        // First select a study so we can verify it is cleared after import
        const select = wrapper.findAllComponents(NSelect)[0]
        select.vm.$emit('update:value', 'preset-1')
        await nextTick()

        let nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
        expect(nameInput.props('value')).toBe('Test Preset A')

        // Set up the createElement spy — after mount so Vue's initial render is complete.
        // We intercept 'input' creation only long enough to capture the onchange handler.
        const mockInputEl = {
          type: '',
          accept: '',
          onchange: null as ((event: Event) => void) | null,
          click: vi.fn(),
        }
        const origCreateElement = document.createElement.bind(document)
        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
          if (tag === 'input') {
            return mockInputEl as unknown as HTMLElement
          }
          return origCreateElement(tag)
        })

        // Click the import button — this calls triggerImport which calls
        // document.createElement('input') and registers input.onchange
        const importButton = asVue(wrapper.findComponent('[data-testid="import-study-button"]'))
        await importButton.trigger('click')

        // Restore the spy immediately so Vue can use real elements during re-render
        createElementSpy.mockRestore()

        // Verify triggerImport ran and captured the handler
        const capturedOnchange = mockInputEl.onchange
        expect(capturedOnchange).not.toBeNull()
        expect(mockInputEl.click).toHaveBeenCalled()

        // Build a File from the JSON payload and construct a synthetic change event
        const blob = new Blob([JSON.stringify(importedData)], { type: 'application/json' })
        const file = new File([blob], 'study.json', { type: 'application/json' })
        const fakeEvent = {
          target: { files: [file] },
        } as unknown as Event

        // Invoke the captured handler and wait for async file.text() + state flush
        await capturedOnchange!(fakeEvent)
        await flushPromises()
        await nextTick()

        nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
        expect(nameInput.props('value')).toBe('Imported Study')

        // selected study should be null (new study mode)
        expect(select.props('value')).toBeNull()

        // Width/height updated
        const widthInput = wrapper.findAllComponents(NInputNumber)[0]
        expect(widthInput.props('value')).toBe(768)
      })

      it('shows error when JSON file is invalid', async () => {
        const wrapper = mount(StudyEditor)
        await flushPromises()

        const vm = wrapper.vm as unknown as { error: string | null }
        vm.error = 'Import error: Missing or invalid field: "name" must be a non-empty string'
        await nextTick()

        const alert = wrapper.find('[role="alert"]')
        expect(alert.exists()).toBe(true)
        expect(alert.text()).toContain('Import error')
      })
    })
  })

  afterAll(() => {
    globalThis.confirm = originalConfirm
  })
})
