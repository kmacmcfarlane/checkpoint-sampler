import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NButton, NInput, NInputNumber, NDynamicInput, NDynamicTags, NTag, NModal } from 'naive-ui'
import StudyEditor from '../StudyEditor.vue'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog.vue'
import { validateStudyImport } from '../studyImportValidation'
import type { Study, ComfyUIModels, WorkflowSummary } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    listStudies: vi.fn(),
    createStudy: vi.fn(),
    updateStudy: vi.fn(),
    deleteStudy: vi.fn(),
    forkStudy: vi.fn(),
    studyHasSamples: vi.fn(),
    getComfyUIModels: vi.fn(),
    listWorkflows: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

import { apiClient } from '../../api/client'

// enableAutoUnmount is configured globally in vitest.setup.ts

const mockListStudies = apiClient.listStudies as ReturnType<typeof vi.fn>
const mockCreateStudy = apiClient.createStudy as ReturnType<typeof vi.fn>
const mockUpdateStudy = apiClient.updateStudy as ReturnType<typeof vi.fn>
const mockDeleteStudy = apiClient.deleteStudy as ReturnType<typeof vi.fn>
const mockForkStudy = apiClient.forkStudy as ReturnType<typeof vi.fn>
const mockStudyHasSamples = apiClient.studyHasSamples as ReturnType<typeof vi.fn>
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>
const mockListWorkflows = apiClient.listWorkflows as ReturnType<typeof vi.fn>

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
    workflow_template: 'my-workflow.json',
    vae: 'ae.safetensors',
    text_encoder: 'clip_l.safetensors',
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
    workflow_template: '',
    vae: '',
    text_encoder: '',
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
    // Default: studies have no samples (no immutability dialog)
    mockStudyHasSamples.mockResolvedValue({ has_samples: false })
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve(mockSamplers)
      if (type === 'scheduler') return Promise.resolve(mockSchedulers)
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
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
      workflow_template: '',
      vae: '',
      text_encoder: '',
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
      workflow_template: 'my-workflow.json',
      vae: 'ae.safetensors',
      text_encoder: 'clip_l.safetensors',
    })
  })

  // AC: FE: Delete button on study shows the standard confirmation dialog
  it('shows ConfirmDeleteDialog when Delete button is clicked', async () => {
    const wrapper = mount(StudyEditor, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select preset
    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await nextTick()

    const dialog = wrapper.findComponent(ConfirmDeleteDialog)
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('show')).toBe(true)
  })

  // AC: FE: Confirmation dialog includes 'Also delete sample data' checkbox (default off)
  it('passes checkboxLabel and default checkboxChecked=false to ConfirmDeleteDialog', async () => {
    const wrapper = mount(StudyEditor, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await nextTick()

    const dialog = wrapper.findComponent(ConfirmDeleteDialog)
    expect(dialog.props('checkboxLabel')).toBe('Also delete sample data')
    expect(dialog.props('checkboxChecked')).toBe(false)
  })

  // AC: FE: Delete calls API without deleteData when checkbox is not checked
  it('deletes study without data when confirm emitted with false', async () => {
    mockDeleteStudy.mockResolvedValue(undefined)

    const wrapper = mount(StudyEditor, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await nextTick()

    // Simulate dialog confirm with checkbox=false (keep sample data)
    const dialog = wrapper.findComponent(ConfirmDeleteDialog)
    await dialog.vm.$emit('confirm', false)
    await flushPromises()

    expect(mockDeleteStudy).toHaveBeenCalledWith('preset-1', false)
  })

  // AC: FE: Delete calls API with deleteData when checkbox is checked
  it('deletes study with data when confirm emitted with true', async () => {
    mockDeleteStudy.mockResolvedValue(undefined)

    const wrapper = mount(StudyEditor, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await nextTick()

    // Simulate dialog confirm with checkbox=true (delete sample data too)
    const dialog = wrapper.findComponent(ConfirmDeleteDialog)
    await dialog.vm.$emit('confirm', true)
    await flushPromises()

    expect(mockDeleteStudy).toHaveBeenCalledWith('preset-1', true)
  })

  // AC: FE: Cancelling the dialog does not call deleteStudy
  it('does not delete study when dialog emits cancel', async () => {
    const wrapper = mount(StudyEditor, {
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const select = wrapper.findAllComponents(NSelect)[0]
    select.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const deleteButton = wrapper
      .findAllComponents(NButton)
      .find((b) => b.text().includes('Delete Study'))!
    await deleteButton.trigger('click')
    await nextTick()

    // Simulate dialog cancel
    const dialog = wrapper.findComponent(ConfirmDeleteDialog)
    await dialog.vm.$emit('cancel')
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
      workflow_template: '',
      vae: '',
      text_encoder: '',
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
        workflow_template: '',
        vae: '',
        text_encoder: '',
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
        workflow_template: '',
        vae: '',
        text_encoder: '',
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

      it('extracts workflow_template when present as a string', () => {
        const result = validateStudyImport({ ...validPayload, workflow_template: 'flux-dev.json' })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.workflow_template).toBe('flux-dev.json')
      })

      it('omits workflow_template when absent', () => {
        const result = validateStudyImport(validPayload)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.workflow_template).toBeUndefined()
      })

      it('omits workflow_template when value is not a string', () => {
        const result = validateStudyImport({ ...validPayload, workflow_template: 42 })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.workflow_template).toBeUndefined()
      })

      it('extracts vae when present as a string', () => {
        const result = validateStudyImport({ ...validPayload, vae: 'ae.safetensors' })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.vae).toBe('ae.safetensors')
      })

      it('omits vae when absent', () => {
        const result = validateStudyImport(validPayload)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.vae).toBeUndefined()
      })

      it('extracts text_encoder when present as a string', () => {
        const result = validateStudyImport({ ...validPayload, text_encoder: 'clip_l.safetensors' })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.text_encoder).toBe('clip_l.safetensors')
      })

      it('omits text_encoder when absent', () => {
        const result = validateStudyImport(validPayload)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.text_encoder).toBeUndefined()
      })

      it('extracts shift when present as a finite number', () => {
        const result = validateStudyImport({ ...validPayload, shift: 3.5 })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.shift).toBe(3.5)
      })

      it('extracts shift of zero', () => {
        const result = validateStudyImport({ ...validPayload, shift: 0 })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.shift).toBe(0)
      })

      it('omits shift when absent', () => {
        const result = validateStudyImport(validPayload)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.shift).toBeUndefined()
      })

      it('omits shift when value is not a finite number', () => {
        const result = validateStudyImport({ ...validPayload, shift: 'fast' })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.shift).toBeUndefined()
      })

      it('omits shift when value is NaN', () => {
        const result = validateStudyImport({ ...validPayload, shift: NaN })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.shift).toBeUndefined()
      })

      it('round-trips all workflow fields through validate', () => {
        const payload = {
          ...validPayload,
          workflow_template: 'my-workflow.json',
          vae: 'ae.safetensors',
          text_encoder: 'clip_l.safetensors',
          shift: 2.5,
        }
        const result = validateStudyImport(payload)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.data.workflow_template).toBe('my-workflow.json')
          expect(result.data.vae).toBe('ae.safetensors')
          expect(result.data.text_encoder).toBe('clip_l.safetensors')
          expect(result.data.shift).toBe(2.5)
        }
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

          // Workflow fields from preset-1
          expect(parsed.workflow_template).toBe('my-workflow.json')
          expect(parsed.vae).toBe('ae.safetensors')
          expect(parsed.text_encoder).toBe('clip_l.safetensors')

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

      it('restores workflow_template, vae, text_encoder, and shift from imported data', async () => {
        const importedData = {
          name: 'Workflow Study',
          prompt_prefix: '',
          prompts: [{ name: 'scene', text: 'a scene' }],
          negative_prompt: '',
          steps: [20],
          cfgs: [7.0],
          sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'simple' }],
          seeds: [1],
          width: 512,
          height: 512,
          workflow_template: 'flux-dev.json',
          vae: 'ae.safetensors',
          text_encoder: 'clip_l.safetensors',
          shift: 3.5,
        }

        const wrapper = mount(StudyEditor)
        await flushPromises()

        const mockInputEl = {
          type: '',
          accept: '',
          onchange: null as ((event: Event) => void) | null,
          click: vi.fn(),
        }
        const origCreateElement = document.createElement.bind(document)
        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
          if (tag === 'input') return mockInputEl as unknown as HTMLElement
          return origCreateElement(tag)
        })

        const importButton = asVue(wrapper.findComponent('[data-testid="import-study-button"]'))
        await importButton.trigger('click')
        createElementSpy.mockRestore()

        const blob = new Blob([JSON.stringify(importedData)], { type: 'application/json' })
        const file = new File([blob], 'study.json', { type: 'application/json' })
        const fakeEvent = { target: { files: [file] } } as unknown as Event

        await mockInputEl.onchange!(fakeEvent)
        await flushPromises()
        await nextTick()

        const vm = wrapper.vm as unknown as {
          workflowTemplate: string | null
          selectedVAE: string | null
          selectedCLIP: string | null
          shiftValue: number | null
        }
        expect(vm.workflowTemplate).toBe('flux-dev.json')
        expect(vm.selectedVAE).toBe('ae.safetensors')
        expect(vm.selectedCLIP).toBe('clip_l.safetensors')
        expect(vm.shiftValue).toBe(3.5)
      })

      it('clears workflow fields when importing data without them', async () => {
        const importedData = {
          name: 'Plain Study',
          prompt_prefix: '',
          prompts: [{ name: 'scene', text: 'a scene' }],
          negative_prompt: '',
          steps: [20],
          cfgs: [7.0],
          sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'simple' }],
          seeds: [1],
          width: 512,
          height: 512,
        }

        const wrapper = mount(StudyEditor)
        await flushPromises()

        // Pre-populate with a study that has workflow fields
        const select = wrapper.findAllComponents(NSelect)[0]
        select.vm.$emit('update:value', 'preset-1')
        await nextTick()

        const mockInputEl = {
          type: '',
          accept: '',
          onchange: null as ((event: Event) => void) | null,
          click: vi.fn(),
        }
        const origCreateElement = document.createElement.bind(document)
        const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
          if (tag === 'input') return mockInputEl as unknown as HTMLElement
          return origCreateElement(tag)
        })

        const importButton = asVue(wrapper.findComponent('[data-testid="import-study-button"]'))
        await importButton.trigger('click')
        createElementSpy.mockRestore()

        const blob = new Blob([JSON.stringify(importedData)], { type: 'application/json' })
        const file = new File([blob], 'study.json', { type: 'application/json' })
        const fakeEvent = { target: { files: [file] } } as unknown as Event

        await mockInputEl.onchange!(fakeEvent)
        await flushPromises()
        await nextTick()

        const vm = wrapper.vm as unknown as {
          workflowTemplate: string | null
          selectedVAE: string | null
          selectedCLIP: string | null
          shiftValue: number | null
        }
        expect(vm.workflowTemplate).toBeNull()
        expect(vm.selectedVAE).toBeNull()
        expect(vm.selectedCLIP).toBeNull()
        expect(vm.shiftValue).toBeNull()
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

  describe('duplicate value validation', () => {
    // Helper: mount and set up a fully valid form state (no pairs — must be set manually).
    async function mountWithValidForm() {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Unique Name')

      const promptInputs = wrapper.findAllComponents(NInput)
      const promptNameInput = promptInputs.find(i => i.props('placeholder')?.includes('Prompt name'))!
      promptNameInput.vm.$emit('update:value', 'forest')
      const promptTextInput = promptInputs.find(i => i.props('placeholder')?.includes('Prompt text'))!
      promptTextInput.vm.$emit('update:value', 'a forest scene')

      const vm = wrapper.vm as unknown as {
        samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }>
        steps: number[]
        cfgs: number[]
        seeds: number[]
        prompts: Array<{ name: string; text: string }>
      }
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'simple' }]
      await nextTick()

      return { wrapper, vm }
    }

    it('shows no validation error when all dimension values are unique', async () => {
      const { wrapper } = await mountWithValidForm()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(false)
    })

    it('shows validation error and disables save for duplicate step values', async () => {
      const { wrapper, vm } = await mountWithValidForm()

      vm.steps = [4, 8, 4]
      await nextTick()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('Duplicate step value: 4')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it('shows validation error and disables save for duplicate CFG values', async () => {
      const { wrapper, vm } = await mountWithValidForm()

      vm.cfgs = [1.0, 3.0, 1.0]
      await nextTick()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('Duplicate CFG value: 1')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it('shows validation error and disables save for duplicate seed values', async () => {
      const { wrapper, vm } = await mountWithValidForm()

      vm.seeds = [42, 420, 42]
      await nextTick()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('Duplicate seed value: 42')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it('shows validation error and disables save for duplicate sampler/scheduler pairs', async () => {
      const { wrapper, vm } = await mountWithValidForm()

      vm.samplerSchedulerPairs = [
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'normal' },
        { sampler: 'euler', scheduler: 'simple' },
      ]
      await nextTick()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('Duplicate sampler/scheduler pair')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it('shows validation error and disables save for duplicate prompt names', async () => {
      const { wrapper, vm } = await mountWithValidForm()

      vm.prompts = [
        { name: 'forest', text: 'a forest' },
        { name: 'city', text: 'a city' },
        { name: 'forest', text: 'another forest' },
      ]
      await nextTick()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('Duplicate prompt name: "forest"')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it('shows validation error when study name conflicts with an existing study', async () => {
      const { wrapper } = await mountWithValidForm()

      // Set the name to match one of the loaded studies
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Test Preset A')
      await nextTick()

      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('already exists')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it('allows saving when renaming an existing study to its own name', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // The name should still be "Test Preset A" and there should be no validation error
      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(false)

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Update Study'))!
      expect(saveButton.props('disabled')).toBe(false)
    })

    // AC: Study name validation rejects characters problematic for directory names.
    // The frontend's disallowed char set (apiDisallowedChars) starts with a bootstrap
    // default and is updated from the backend error response on rejected saves.
    it.each([
      ['(', 'study(1)'],
      [')', 'study)1'],
      ['/', 'study/v2'],
      ['\\', 'study\\v2'],
      [':', 'study:v2'],
      ['*', 'study*'],
      ['?', 'study?'],
      ['<', 'study<v2'],
      ['>', 'study>v2'],
      ['|', 'study|v2'],
      ['"', 'study"v2'],
    ])('shows validation error and disables save when name contains "%s"', async (_char, name) => {
      const { wrapper } = await mountWithValidForm()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', name)
      await nextTick()

      // AC: Validation error displayed inline in the study editor
      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(true)
      expect(warningAlert.text()).toContain('disallowed characters')

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))!
      expect(saveButton.props('disabled')).toBe(true)
    })

    it.each([
      ['alphanumeric', 'MyStudy123'],
      ['hyphens', 'my-study-v2'],
      ['underscores', 'my_study_v2'],
      ['dots', 'my.study.v2'],
      ['spaces', 'My Study Config'],
    ])('accepts valid name with %s', async (_desc, name) => {
      const { wrapper } = await mountWithValidForm()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', name)
      await nextTick()

      // No validation error for safe characters
      const warningAlert = wrapper.find('[data-testid="local-validation-error"]')
      expect(warningAlert.exists()).toBe(false)
    })

    // AC: FE: Frontend reflects disallowed characters from the API rather than
    //         maintaining a duplicate constant.
    // When the backend returns a disallowed-characters error, the frontend updates
    // its apiDisallowedChars ref from the error message, keeping them in sync
    // without a separately maintained constant.
    it('updates apiDisallowedChars from backend error response', async () => {
      const updatedCharSet = `()/\\:*?<>|"!@`  // hypothetical future chars from backend
      mockCreateStudy.mockRejectedValueOnce({
        message: `study name contains disallowed characters; the following characters are not allowed: ${updatedCharSet}`,
      })

      const { wrapper, vm } = await mountWithValidForm()
      const vmTyped = wrapper.vm as unknown as { apiDisallowedChars: string }

      // Trigger a save that reaches the API (use a name without current disallowed chars
      // so local validation passes, then the API rejects it with an updated char set)
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'SomeValidLookingName')
      await nextTick()
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'simple' }]
      await nextTick()

      const saveButton = wrapper
        .findAllComponents(NButton)
        .find(b => b.text().includes('Save Study'))
      if (saveButton) {
        await saveButton.trigger('click')
        await flushPromises()
      }

      // After the API error, apiDisallowedChars should reflect the backend's updated set
      expect(vmTyped.apiDisallowedChars).toBe(updatedCharSet)
    })
  })

  describe('field validation highlighting', () => {
    // Helper: mount and set up a fully valid form state for highlighting tests.
    async function mountWithValidForm() {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Unique Name')

      const promptInputs = wrapper.findAllComponents(NInput)
      const promptNameInput = promptInputs.find(i => i.props('placeholder')?.includes('Prompt name'))!
      promptNameInput.vm.$emit('update:value', 'forest')
      const promptTextInput = promptInputs.find(i => i.props('placeholder')?.includes('Prompt text'))!
      promptTextInput.vm.$emit('update:value', 'a forest scene')

      const vm = wrapper.vm as unknown as {
        samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }>
        steps: number[]
        cfgs: number[]
        seeds: number[]
        prompts: Array<{ name: string; text: string }>
      }
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'simple' }]
      await nextTick()

      return { wrapper, vm }
    }

    // AC: FE: Fields with validation errors are visually highlighted (red border or similar)
    // AC: FE: Highlight clears when the validation error is resolved

    it('study name input has error status when name contains disallowed characters', async () => {
      // AC: Fields with validation errors are visually highlighted
      const { wrapper } = await mountWithValidForm()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Bad(Name)')
      await nextTick()

      // NInput status prop should be 'error' when study name is invalid
      expect(nameInput.props('status')).toBe('error')
    })

    it('study name input error status clears when invalid characters are removed', async () => {
      // AC: Highlight clears when the validation error is resolved
      const { wrapper } = await mountWithValidForm()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      // Set invalid name
      nameInput.vm.$emit('update:value', 'Bad:Name')
      await nextTick()
      expect(nameInput.props('status')).toBe('error')

      // Fix the name
      nameInput.vm.$emit('update:value', 'GoodName')
      await nextTick()
      expect(nameInput.props('status')).toBeUndefined()
    })

    it('study name input has error status when name conflicts with existing study', async () => {
      // AC: Fields with validation errors are visually highlighted (duplicate study name)
      const { wrapper } = await mountWithValidForm()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Test Preset A')
      await nextTick()

      expect(nameInput.props('status')).toBe('error')
    })

    it('study name input has no error status when name is valid', async () => {
      const { wrapper } = await mountWithValidForm()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      expect(nameInput.props('status')).toBeUndefined()
    })

    // Helper: find an NTag component by its data-testid attribute.
    // renderTag functions pass data-testid as an attribute to the NTag h() call,
    // which is forwarded to the root DOM element (Vue 3 fallthrough attrs).
    function findTagByTestId(wrapper: VueWrapper, testId: string) {
      return wrapper.findAllComponents(NTag).find(
        t => t.element.getAttribute('data-testid') === testId
      )
    }

    it('duplicate step tag gets error type, first occurrence does not', async () => {
      // AC: FE: Fields with validation errors are visually highlighted
      // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
      const { wrapper, vm } = await mountWithValidForm()

      vm.steps = [4, 8, 4]
      await nextTick()

      expect(findTagByTestId(wrapper, 'step-tag-0')?.props('type')).toBe('default') // first '4', not a duplicate
      expect(findTagByTestId(wrapper, 'step-tag-1')?.props('type')).toBe('default') // '8', unique
      expect(findTagByTestId(wrapper, 'step-tag-2')?.props('type')).toBe('error')   // second '4', duplicate
    })

    it('step tag error type clears when duplicate step is removed', async () => {
      // AC: FE: Highlight clears when the validation error is resolved
      const { wrapper, vm } = await mountWithValidForm()

      vm.steps = [4, 8, 4]
      await nextTick()
      expect(findTagByTestId(wrapper, 'step-tag-2')?.props('type')).toBe('error')

      // Fix by removing duplicate — now only 2 tags
      vm.steps = [4, 8]
      await nextTick()
      expect(findTagByTestId(wrapper, 'step-tag-0')?.props('type')).toBe('default')
      expect(findTagByTestId(wrapper, 'step-tag-1')?.props('type')).toBe('default')
    })

    it('duplicate CFG tag gets error type, first occurrence does not', async () => {
      // AC: FE: Fields with validation errors are visually highlighted
      // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
      const { wrapper, vm } = await mountWithValidForm()

      vm.cfgs = [1.0, 3.0, 1.0]
      await nextTick()

      expect(findTagByTestId(wrapper, 'cfg-tag-0')?.props('type')).toBe('default') // first '1.0', not a duplicate
      expect(findTagByTestId(wrapper, 'cfg-tag-1')?.props('type')).toBe('default') // '3.0', unique
      expect(findTagByTestId(wrapper, 'cfg-tag-2')?.props('type')).toBe('error')   // second '1.0', duplicate
    })

    it('cfg tag error type clears when duplicate CFG is removed', async () => {
      // AC: FE: Highlight clears when the validation error is resolved
      const { wrapper, vm } = await mountWithValidForm()

      vm.cfgs = [1.0, 3.0, 1.0]
      await nextTick()
      expect(findTagByTestId(wrapper, 'cfg-tag-2')?.props('type')).toBe('error')

      vm.cfgs = [1.0, 3.0]
      await nextTick()
      expect(findTagByTestId(wrapper, 'cfg-tag-0')?.props('type')).toBe('default')
      expect(findTagByTestId(wrapper, 'cfg-tag-1')?.props('type')).toBe('default')
    })

    it('duplicate seed tag gets error type, first occurrence does not', async () => {
      // AC: FE: Fields with validation errors are visually highlighted
      // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
      const { wrapper, vm } = await mountWithValidForm()

      vm.seeds = [42, 420, 42]
      await nextTick()

      expect(findTagByTestId(wrapper, 'seed-tag-0')?.props('type')).toBe('default') // first '42', not a duplicate
      expect(findTagByTestId(wrapper, 'seed-tag-1')?.props('type')).toBe('default') // '420', unique
      expect(findTagByTestId(wrapper, 'seed-tag-2')?.props('type')).toBe('error')   // second '42', duplicate
    })

    it('seed tag error type clears when duplicate seed is removed', async () => {
      // AC: FE: Highlight clears when the validation error is resolved
      const { wrapper, vm } = await mountWithValidForm()

      vm.seeds = [42, 420, 42]
      await nextTick()
      expect(findTagByTestId(wrapper, 'seed-tag-2')?.props('type')).toBe('error')

      vm.seeds = [42, 420]
      await nextTick()
      expect(findTagByTestId(wrapper, 'seed-tag-0')?.props('type')).toBe('default')
      expect(findTagByTestId(wrapper, 'seed-tag-1')?.props('type')).toBe('default')
    })

    it('only the duplicate prompt row gets field-error class, not the first occurrence', async () => {
      // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
      const { wrapper, vm } = await mountWithValidForm()

      vm.prompts = [
        { name: 'forest', text: 'a forest' },
        { name: 'city', text: 'a city' },
        { name: 'forest', text: 'another forest' }, // duplicate at index 2
      ]
      await nextTick()

      // First row (index 0) should NOT have error class
      const row0 = wrapper.find('[data-testid="prompt-row-0"]')
      expect(row0.classes()).not.toContain('field-error')

      // Second row (index 1) has a unique name, should NOT have error class
      const row1 = wrapper.find('[data-testid="prompt-row-1"]')
      expect(row1.classes()).not.toContain('field-error')

      // Third row (index 2) is the duplicate, SHOULD have error class
      const row2 = wrapper.find('[data-testid="prompt-row-2"]')
      expect(row2.classes()).toContain('field-error')
    })

    it('prompt row field-error class clears when duplicate prompt name is fixed', async () => {
      // AC: FE: Highlight clears when the validation error is resolved
      const { wrapper, vm } = await mountWithValidForm()

      vm.prompts = [
        { name: 'forest', text: 'a forest' },
        { name: 'forest', text: 'another forest' }, // duplicate at index 1
      ]
      await nextTick()

      expect(wrapper.find('[data-testid="prompt-row-1"]').classes()).toContain('field-error')

      // Fix by renaming the duplicate
      vm.prompts = [
        { name: 'forest', text: 'a forest' },
        { name: 'city', text: 'another forest' },
      ]
      await nextTick()
      // Re-query after state change to avoid stale element reference
      expect(wrapper.find('[data-testid="prompt-row-1"]').classes()).not.toContain('field-error')
    })

    it('only the duplicate sampler/scheduler pair row gets field-error class', async () => {
      // AC: FE: For duplicate values, all duplicate occurrences except the first are highlighted
      const { wrapper, vm } = await mountWithValidForm()

      vm.samplerSchedulerPairs = [
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'normal' },
        { sampler: 'euler', scheduler: 'simple' }, // duplicate at index 2
      ]
      await nextTick()

      // First row (index 0) should NOT have error class
      const pair0 = wrapper.find('[data-testid="pair-row-0"]')
      expect(pair0.classes()).not.toContain('field-error')

      // Second row (index 1) is unique, should NOT have error class
      const pair1 = wrapper.find('[data-testid="pair-row-1"]')
      expect(pair1.classes()).not.toContain('field-error')

      // Third row (index 2) is the duplicate, SHOULD have error class
      const pair2 = wrapper.find('[data-testid="pair-row-2"]')
      expect(pair2.classes()).toContain('field-error')
    })

    it('pair row field-error class clears when duplicate pair is fixed', async () => {
      // AC: FE: Highlight clears when the validation error is resolved
      const { wrapper, vm } = await mountWithValidForm()

      vm.samplerSchedulerPairs = [
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'euler', scheduler: 'simple' }, // duplicate at index 1
      ]
      await nextTick()

      expect(wrapper.find('[data-testid="pair-row-1"]').classes()).toContain('field-error')

      // Fix by changing the duplicate pair
      vm.samplerSchedulerPairs = [
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'normal' },
      ]
      await nextTick()
      // Re-query after state change to avoid stale element reference
      expect(wrapper.find('[data-testid="pair-row-1"]').classes()).not.toContain('field-error')
    })

    it('step tags have default type when all steps are unique', async () => {
      // AC: Only the correct fields are highlighted, not all fields
      const { wrapper } = await mountWithValidForm()

      // Default initial steps value is [30], so index 0 should be default type
      expect(findTagByTestId(wrapper, 'step-tag-0')?.props('type')).toBe('default')
    })

    it('cfg and seed tags have default type when only steps have duplicates', async () => {
      // AC: Only the correct fields are highlighted, not all fields
      const { wrapper, vm } = await mountWithValidForm()

      vm.steps = [4, 8, 4] // only steps are duplicated
      await nextTick()

      // CFG tag (index 0) should not be error type
      expect(findTagByTestId(wrapper, 'cfg-tag-0')?.props('type')).toBe('default')

      // Seed tag (index 0) should not be error type
      expect(findTagByTestId(wrapper, 'seed-tag-0')?.props('type')).toBe('default')
    })
  })

  describe('immutability dialog', () => {
    it('shows immutability dialog when updating a study that has generated samples', async () => {
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Immutability dialog should be shown, updateStudy should NOT have been called
      expect(mockUpdateStudy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="immutability-dialog"]').exists() ||
        wrapper.findComponent(NModal).exists()).toBe(true)
    })

    it('does not show immutability dialog when study has no samples', async () => {
      // Default mock already returns { has_samples: false }
      const updatedStudy: Study = {
        ...studies[0],
        name: 'Updated Preset A',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockUpdateStudy.mockResolvedValue(updatedStudy)

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Should save directly without showing dialog
      expect(mockUpdateStudy).toHaveBeenCalled()
    })

    it('forks study when "Create New Study" is clicked in immutability dialog', async () => {
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })
      const forkedStudy: Study = {
        ...studies[0],
        id: 'forked-1',
        name: 'Test Preset A - copy',
      }
      mockForkStudy.mockResolvedValue(forkedStudy)

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update to trigger immutability check
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Click the fork button
      const forkButton = wrapper.find('[data-testid="immutability-fork-button"]')
      if (forkButton.exists()) {
        await forkButton.trigger('click')
      } else {
        // Find by button text if data-testid not found via DOM (NModal teleport)
        const allButtons = wrapper.findAllComponents(NButton)
        const fork = allButtons.find(b => b.text().includes('Create New Study'))
        expect(fork).toBeTruthy()
        await fork!.trigger('click')
      }
      await flushPromises()

      expect(mockForkStudy).toHaveBeenCalledWith(
        expect.objectContaining({
          source_id: 'preset-1',
          name: 'Test Preset A - copy',
        })
      )
      expect(mockUpdateStudy).not.toHaveBeenCalled()
    })

    it('fork suffix does not contain disallowed characters', async () => {
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })
      const forkedStudy: Study = {
        ...studies[0],
        id: 'forked-1',
        name: 'Test Preset A - copy',
      }
      mockForkStudy.mockResolvedValue(forkedStudy)

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study to trigger the fork flow
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update to trigger immutability check
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Click the fork button to trigger a fork
      const forkButton = wrapper.find('[data-testid="immutability-fork-button"]')
      if (forkButton.exists()) {
        await forkButton.trigger('click')
      } else {
        const allButtons = wrapper.findAllComponents(NButton)
        const fork = allButtons.find(b => b.text().includes('Create New Study'))
        expect(fork).toBeTruthy()
        await fork!.trigger('click')
      }
      await flushPromises()

      // Verify forkStudy was called (meaning the forked name passed validation)
      expect(mockForkStudy).toHaveBeenCalled()
      const calledName: string = mockForkStudy.mock.calls[0][0].name as string
      // The forked name must not contain any disallowed characters
      const disallowedChars = `()/\\:*?<>|"`
      for (const ch of disallowedChars) {
        expect(calledName).not.toContain(ch)
      }
    })

    it('updates study in-place when "Re-generate Samples" is clicked', async () => {
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })
      const updatedStudy: Study = {
        ...studies[0],
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockUpdateStudy.mockResolvedValue(updatedStudy)

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update to trigger immutability check
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Click the regen button
      const regenButton = wrapper.find('[data-testid="immutability-regen-button"]')
      if (regenButton.exists()) {
        await regenButton.trigger('click')
      } else {
        const allButtons = wrapper.findAllComponents(NButton)
        const regen = allButtons.find(b => b.text().includes('Re-generate'))
        expect(regen).toBeTruthy()
        await regen!.trigger('click')
      }
      await flushPromises()

      expect(mockUpdateStudy).toHaveBeenCalled()
      expect(mockForkStudy).not.toHaveBeenCalled()
    })

    // B-106 AC1/AC2: Re-generate emits study-regenerate event after successful save
    it('emits study-regenerate with the updated study when "Re-generate Samples" succeeds', async () => {
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })
      const updatedStudy: Study = {
        ...studies[0],
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockUpdateStudy.mockResolvedValue(updatedStudy)

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update to trigger immutability check
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Click the regen button
      const regenButton = wrapper.find('[data-testid="immutability-regen-button"]')
      if (regenButton.exists()) {
        await regenButton.trigger('click')
      } else {
        const allButtons = wrapper.findAllComponents(NButton)
        const regen = allButtons.find(b => b.text().includes('Re-generate'))
        expect(regen).toBeTruthy()
        await regen!.trigger('click')
      }
      await flushPromises()

      // AC1: study-regenerate emitted with the updated study
      const emitted = wrapper.emitted('study-regenerate')
      expect(emitted).toBeTruthy()
      expect(emitted!.length).toBe(1)
      expect(emitted![0][0]).toMatchObject({ id: 'preset-1' })
    })

    // B-106: study-regenerate NOT emitted when save fails
    it('does not emit study-regenerate when the save fails', async () => {
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })
      mockUpdateStudy.mockRejectedValue({ message: 'Save failed' })

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select an existing study
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Click Update to trigger immutability check
      const saveButton = wrapper
        .findAllComponents(NButton)
        .find((b) => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Click the regen button
      const regenButton = wrapper.find('[data-testid="immutability-regen-button"]')
      if (regenButton.exists()) {
        await regenButton.trigger('click')
      } else {
        const allButtons = wrapper.findAllComponents(NButton)
        const regen = allButtons.find(b => b.text().includes('Re-generate'))
        expect(regen).toBeTruthy()
        await regen!.trigger('click')
      }
      await flushPromises()

      // study-regenerate should NOT be emitted when save failed
      expect(wrapper.emitted('study-regenerate')).toBeUndefined()
    })
  })

  // S-112: Workflow template, VAE, CLIP, and shift fields in study definition
  describe('workflow template, VAE, CLIP, and shift fields (S-112)', () => {
    const sampleWorkflows: WorkflowSummary[] = [
      {
        name: 'flux-image.json',
        validation_state: 'valid',
        roles: { save_image: ['9'], unet_loader: ['4'] },
        warnings: [],
      },
      {
        name: 'auraflow-image.json',
        validation_state: 'valid',
        roles: { save_image: ['9'], unet_loader: ['4'], shift: ['3'] },
        warnings: [],
      },
      {
        name: 'broken-workflow.json',
        validation_state: 'invalid',
        roles: {},
        warnings: ['Missing required roles'],
      },
    ]

    beforeEach(() => {
      mockListWorkflows.mockResolvedValue(sampleWorkflows)
      mockGetComfyUIModels.mockImplementation((type: string) => {
        if (type === 'sampler') return Promise.resolve({ models: ['euler'] })
        if (type === 'scheduler') return Promise.resolve({ models: ['normal'] })
        if (type === 'vae') return Promise.resolve({ models: ['ae.safetensors', 'vae-ft.safetensors'] })
        if (type === 'clip') return Promise.resolve({ models: ['clip_l.safetensors', 't5xxl.safetensors'] })
        return Promise.resolve({ models: [] })
      })
    })

    // AC: StudyEditor fetches and populates workflow template options
    it('fetches workflows, VAE, and CLIP options on mount', async () => {
      mount(StudyEditor)
      await flushPromises()

      expect(mockListWorkflows).toHaveBeenCalled()
      expect(mockGetComfyUIModels).toHaveBeenCalledWith('vae')
      expect(mockGetComfyUIModels).toHaveBeenCalledWith('clip')
    })

    // AC: Only valid workflows appear in the workflow template select options
    it('shows only valid workflows in workflow template select', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect)
      const options = workflowSelect.props('options') as Array<{ label: string; value: string }>
      expect(options).toHaveLength(2) // Only the 2 valid ones
      expect(options.map(o => o.value)).toContain('flux-image.json')
      expect(options.map(o => o.value)).toContain('auraflow-image.json')
      expect(options.map(o => o.value)).not.toContain('broken-workflow.json')
    })

    // AC: Shift input is hidden when selected workflow has no shift role
    it('does not show shift input when workflow has no shift role', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-image.json')
      await nextTick()

      const shiftInput = wrapper.find('[data-testid="study-shift-input"]')
      expect(shiftInput.exists()).toBe(false)
    })

    // AC: Shift input is shown when selected workflow has a shift role
    it('shows shift input when workflow has shift role', async () => {
      const wrapper = mount(StudyEditor)
      await flushPromises()

      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'auraflow-image.json')
      await nextTick()

      const shiftInput = wrapper.find('[data-testid="study-shift-input"]')
      expect(shiftInput.exists()).toBe(true)
    })

    // AC: Loading a study pre-fills workflow_template, vae, text_encoder, shift
    it('pre-fills workflow_template, vae, text_encoder, shift when study is loaded', async () => {
      // Use studies[0] which has workflow_template='my-workflow.json', vae='ae.safetensors', text_encoder='clip_l.safetensors'
      const wrapper = mount(StudyEditor)
      await flushPromises()

      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      const vm = wrapper.vm as unknown as {
        workflowTemplate: string | null
        selectedVAE: string | null
        selectedCLIP: string | null
        shiftValue: number | null
      }
      expect(vm.workflowTemplate).toBe('my-workflow.json')
      expect(vm.selectedVAE).toBe('ae.safetensors')
      expect(vm.selectedCLIP).toBe('clip_l.safetensors')
      expect(vm.shiftValue).toBeNull()
    })

    // AC: workflow_template, vae, text_encoder are sent in create payload
    it('includes workflow_template, vae, and text_encoder in create payload', async () => {
      const createdStudy: Study = {
        id: 'new-id',
        name: 'Workflow Study',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        workflow_template: 'flux-image.json',
        vae: 'ae.safetensors',
        text_encoder: 'clip_l.safetensors',
        images_per_checkpoint: 1,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockCreateStudy.mockResolvedValue(createdStudy)

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Fill in form
      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Workflow Study')
      await nextTick()

      // Set workflow, VAE, CLIP
      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-image.json')
      wrapper.find('[data-testid="study-vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="study-clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')

      // Also add a sampler pair and prompt to meet canSave requirements
      const vm = wrapper.vm as unknown as {
        samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }>
        prompts: Array<{ name: string; text: string }>
      }
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]
      vm.prompts = [{ name: 'test', text: 'test prompt' }]
      await nextTick()

      const saveButton = wrapper.findAllComponents(NButton).find(b => b.text().includes('Save Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      expect(mockCreateStudy).toHaveBeenCalled()
      const payload = mockCreateStudy.mock.calls[0][0]
      expect(payload.workflow_template).toBe('flux-image.json')
      expect(payload.vae).toBe('ae.safetensors')
      expect(payload.text_encoder).toBe('clip_l.safetensors')
    })

    // AC: MRU workflow template is applied when creating a new study
    it('applies MRU workflow template when clicking New Study', async () => {
      localStorage.setItem('checkpoint-sampler:mru-workflow-template', 'flux-image.json')

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Click New Study
      const newButton = wrapper.findAllComponents(NButton).find(b => b.text() === 'New Study')!
      await newButton.trigger('click')
      await nextTick()

      const vm = wrapper.vm as unknown as { workflowTemplate: string | null }
      expect(vm.workflowTemplate).toBe('flux-image.json')

      localStorage.removeItem('checkpoint-sampler:mru-workflow-template')
    })

    // AC1: MRU VAE and text encoder are auto-filled when user selects a workflow
    it('auto-fills VAE and text encoder from MRU when user selects a workflow', async () => {
      // Pre-seed MRU for 'flux-image.json'
      localStorage.setItem(
        'checkpoint-sampler:mru-workflow-vae-te',
        JSON.stringify({ 'flux-image.json': { vae: 'ae.safetensors', textEncoder: 'clip_l.safetensors' } }),
      )

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Simulate user selecting workflow via NSelect update:value event
      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-image.json')
      await nextTick()

      const vm = wrapper.vm as unknown as { selectedVAE: string | null; selectedCLIP: string | null }
      expect(vm.selectedVAE).toBe('ae.safetensors')
      expect(vm.selectedCLIP).toBe('clip_l.safetensors')

      localStorage.removeItem('checkpoint-sampler:mru-workflow-vae-te')
    })

    // AC1: When no MRU is stored for a workflow, VAE and TE are not auto-filled
    it('does not auto-fill VAE and text encoder when no MRU is stored for the selected workflow', async () => {
      localStorage.removeItem('checkpoint-sampler:mru-workflow-vae-te')

      const wrapper = mount(StudyEditor)
      await flushPromises()

      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-image.json')
      await nextTick()

      const vm = wrapper.vm as unknown as { selectedVAE: string | null; selectedCLIP: string | null }
      expect(vm.selectedVAE).toBeNull()
      expect(vm.selectedCLIP).toBeNull()
    })

    // AC1: MRU VAE/TE are saved per-workflow when study is saved
    it('saves VAE and text encoder MRU per workflow when saving a study', async () => {
      const createdStudy: Study = {
        id: 'new-id',
        name: 'MRU Test Study',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        workflow_template: 'flux-image.json',
        vae: 'ae.safetensors',
        text_encoder: 'clip_l.safetensors',
        images_per_checkpoint: 1,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockCreateStudy.mockResolvedValue(createdStudy)

      localStorage.removeItem('checkpoint-sampler:mru-workflow-vae-te')

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Set form fields directly via vm to meet canSave requirements
      const vm = wrapper.vm as unknown as {
        workflowTemplate: string | null
        selectedVAE: string | null
        selectedCLIP: string | null
        samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }>
        prompts: Array<{ name: string; text: string }>
      }

      // Simulate user selecting workflow (which sets workflowTemplate via handler)
      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-image.json')
      await nextTick()

      // Set VAE and CLIP
      wrapper.find('[data-testid="study-vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="study-clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await nextTick()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'MRU Test Study')
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'normal' }]
      vm.prompts = [{ name: 'test', text: 'test prompt' }]
      await nextTick()

      const saveButton = wrapper.findAllComponents(NButton).find(b => b.text().includes('Save Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Verify MRU was saved
      const rawMru = localStorage.getItem('checkpoint-sampler:mru-workflow-vae-te')
      expect(rawMru).not.toBeNull()
      const mru = JSON.parse(rawMru!)
      expect(mru['flux-image.json']).toEqual({ vae: 'ae.safetensors', textEncoder: 'clip_l.safetensors' })

      localStorage.removeItem('checkpoint-sampler:mru-workflow-vae-te')
    })

    // AC3: Loading an existing study does NOT trigger MRU auto-fill (pre-fill takes priority)
    it('does not override study values with MRU when loading an existing study', async () => {
      // Pre-seed MRU with different values
      localStorage.setItem(
        'checkpoint-sampler:mru-workflow-vae-te',
        JSON.stringify({ 'my-workflow.json': { vae: 'mru-vae.safetensors', textEncoder: 'mru-clip.safetensors' } }),
      )

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Load study (preset-1 has workflow='my-workflow.json', vae='ae.safetensors', text_encoder='clip_l.safetensors')
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // The values from the study should be preserved, NOT the MRU values
      const vm = wrapper.vm as unknown as { selectedVAE: string | null; selectedCLIP: string | null }
      expect(vm.selectedVAE).toBe('ae.safetensors')
      expect(vm.selectedCLIP).toBe('clip_l.safetensors')

      localStorage.removeItem('checkpoint-sampler:mru-workflow-vae-te')
    })

    // AC2: Selecting a different workflow applies that workflow's MRU values
    it('applies correct MRU per-workflow when switching between workflows', async () => {
      localStorage.setItem(
        'checkpoint-sampler:mru-workflow-vae-te',
        JSON.stringify({
          'flux-image.json': { vae: 'flux-vae.safetensors', textEncoder: 'clip_l.safetensors' },
          'auraflow-image.json': { vae: 'aura-vae.safetensors', textEncoder: 't5xxl.safetensors' },
        }),
      )

      const wrapper = mount(StudyEditor)
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect)

      // Select first workflow
      workflowSelect.vm.$emit('update:value', 'flux-image.json')
      await nextTick()
      const vm = wrapper.vm as unknown as { selectedVAE: string | null; selectedCLIP: string | null }
      expect(vm.selectedVAE).toBe('flux-vae.safetensors')
      expect(vm.selectedCLIP).toBe('clip_l.safetensors')

      // Switch to second workflow
      workflowSelect.vm.$emit('update:value', 'auraflow-image.json')
      await nextTick()
      expect(vm.selectedVAE).toBe('aura-vae.safetensors')
      expect(vm.selectedCLIP).toBe('t5xxl.safetensors')

      localStorage.removeItem('checkpoint-sampler:mru-workflow-vae-te')
    })
  })

  describe('sampler/scheduler MRU per workflow template (S-127)', () => {
    const MRU_KEY = 'checkpoint-sampler:mru-workflow-sampler-scheduler'

    // AC1: Sampler and scheduler MRU values stored in localStorage per workflow template
    it('saves sampler/scheduler pairs MRU per workflow when saving a study', async () => {
      const createdStudy: Study = {
        id: 'mru-sampler-study',
        name: 'Sampler MRU Study',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'test prompt' }],
        negative_prompt: '',
        steps: [30],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'karras' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        workflow_template: 'flux-dev.json',
        vae: '',
        text_encoder: '',
        images_per_checkpoint: 1,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockCreateStudy.mockResolvedValue(createdStudy)

      const wrapper = mount(StudyEditor)
      await flushPromises()

      const vm = wrapper.vm as unknown as {
        samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }>
        prompts: Array<{ name: string; text: string }>
      }

      // Select workflow via NSelect event (triggers onWorkflowTemplateChange)
      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-dev.json')
      await nextTick()

      const nameInput = asVue(wrapper.findComponent('[data-testid="study-name-input"]'))
      nameInput.vm.$emit('update:value', 'Sampler MRU Study')
      vm.samplerSchedulerPairs = [{ sampler: 'euler', scheduler: 'karras' }]
      vm.prompts = [{ name: 'test', text: 'test prompt' }]
      await nextTick()

      const saveButton = wrapper.findAllComponents(NButton).find(b => b.text().includes('Save Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // AC1: MRU was saved to localStorage under the workflow name key
      const rawMru = localStorage.getItem(MRU_KEY)
      expect(rawMru).not.toBeNull()
      const mru = JSON.parse(rawMru!)
      expect(mru['flux-dev.json']).toEqual([{ sampler: 'euler', scheduler: 'karras' }])
    })

    // AC2: Selecting a workflow auto-fills sampler/scheduler from stored MRU values
    it('auto-fills sampler/scheduler pairs from MRU when user selects a workflow', async () => {
      // Pre-seed MRU for 'flux-dev.json'
      localStorage.setItem(
        MRU_KEY,
        JSON.stringify({ 'flux-dev.json': [{ sampler: 'heun', scheduler: 'normal' }] }),
      )

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Simulate user selecting workflow via NSelect update:value event
      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-dev.json')
      await nextTick()

      // AC2: sampler/scheduler pairs should be auto-filled from MRU
      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      expect(vm.samplerSchedulerPairs).toEqual([{ sampler: 'heun', scheduler: 'normal' }])
    })

    // AC2: When no MRU is stored for a workflow, sampler/scheduler pairs are not auto-filled
    it('does not auto-fill sampler/scheduler pairs when no MRU is stored for the selected workflow', async () => {
      localStorage.removeItem(MRU_KEY)

      const wrapper = mount(StudyEditor)
      await flushPromises()

      wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect).vm.$emit('update:value', 'flux-dev.json')
      await nextTick()

      // No MRU stored — pairs should remain at the default (empty after resetForm)
      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      expect(vm.samplerSchedulerPairs).toEqual([])
    })

    // AC3: MRU defaults do not override values when dialog is pre-filled from external action
    it('does not override study sampler/scheduler pairs with MRU when loading an existing study', async () => {
      // Pre-seed MRU with different pairs for 'my-workflow.json'
      localStorage.setItem(
        MRU_KEY,
        JSON.stringify({ 'my-workflow.json': [{ sampler: 'dpm_2', scheduler: 'exponential' }] }),
      )

      const wrapper = mount(StudyEditor)
      await flushPromises()

      // Load study (preset-1 has workflow='my-workflow.json', pairs=[euler/simple, heun/normal])
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // AC3: The values from the study should be preserved, NOT the MRU values
      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }
      expect(vm.samplerSchedulerPairs).toEqual([
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'normal' },
      ])
    })

    // AC2: Selecting a different workflow applies that workflow's MRU values
    it('applies correct MRU per-workflow when switching between workflows', async () => {
      localStorage.setItem(
        MRU_KEY,
        JSON.stringify({
          'flux-dev.json': [{ sampler: 'euler', scheduler: 'karras' }],
          'auraflow.json': [{ sampler: 'dpm_2', scheduler: 'exponential' }, { sampler: 'heun', scheduler: 'normal' }],
        }),
      )

      const wrapper = mount(StudyEditor)
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="study-workflow-template-select"]').findComponent(NSelect)
      const vm = wrapper.vm as unknown as { samplerSchedulerPairs: Array<{ sampler: string; scheduler: string }> }

      // Select first workflow
      workflowSelect.vm.$emit('update:value', 'flux-dev.json')
      await nextTick()
      expect(vm.samplerSchedulerPairs).toEqual([{ sampler: 'euler', scheduler: 'karras' }])

      // Switch to second workflow
      workflowSelect.vm.$emit('update:value', 'auraflow.json')
      await nextTick()
      expect(vm.samplerSchedulerPairs).toEqual([
        { sampler: 'dpm_2', scheduler: 'exponential' },
        { sampler: 'heun', scheduler: 'normal' },
      ])
    })

    // AC1: MRU is also saved when forking a study
    it('saves sampler/scheduler pairs MRU per workflow when forking a study', async () => {
      const forkedStudy: Study = {
        id: 'forked-study',
        name: 'Test Preset A - copy',
        prompt_prefix: 'photo of a person, ',
        prompts: [{ name: 'forest', text: 'a mystical forest' }],
        negative_prompt: 'low quality',
        steps: [1, 4, 8],
        cfgs: [1.0, 3.0, 7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'simple' }],
        seeds: [42, 420],
        width: 1024,
        height: 1024,
        workflow_template: 'my-workflow.json',
        vae: 'ae.safetensors',
        text_encoder: 'clip_l.safetensors',
        images_per_checkpoint: 1,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      }
      mockForkStudy.mockResolvedValue(forkedStudy)
      mockStudyHasSamples.mockResolvedValue({ has_samples: true })

      const wrapper = mount(StudyEditor, {
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Load preset-1 (has workflow_template = 'my-workflow.json')
      const select = wrapper.findAllComponents(NSelect)[0]
      select.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Trigger save (which will show immutability dialog since has_samples = true)
      const saveButton = wrapper.findAllComponents(NButton).find(b => b.text().includes('Update Study'))!
      await saveButton.trigger('click')
      await flushPromises()

      // Confirm fork via immutability dialog
      const forkButton = wrapper.find('[data-testid="immutability-fork-button"]')
      if (forkButton.exists()) {
        await forkButton.trigger('click')
      } else {
        const allButtons = wrapper.findAllComponents(NButton)
        const fork = allButtons.find(b => b.text().includes('Create New Study'))
        expect(fork).toBeTruthy()
        await fork!.trigger('click')
      }
      await flushPromises()

      // MRU should have been saved for 'my-workflow.json'
      const rawMru = localStorage.getItem(MRU_KEY)
      expect(rawMru).not.toBeNull()
      const mru = JSON.parse(rawMru!)
      expect(mru['my-workflow.json']).toEqual([
        { sampler: 'euler', scheduler: 'simple' },
        { sampler: 'heun', scheduler: 'normal' },
      ])
    })
  })

})

