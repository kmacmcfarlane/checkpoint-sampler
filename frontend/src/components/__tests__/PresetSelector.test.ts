import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PresetSelector from '../PresetSelector.vue'
import type { Preset } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getPresets: vi.fn(),
    createPreset: vi.fn(),
    deletePreset: vi.fn(),
  },
}))

// Mock window.prompt
const originalPrompt = globalThis.prompt
beforeEach(() => {
  globalThis.prompt = vi.fn()
})

import { apiClient } from '../../api/client'

const mockGetPresets = apiClient.getPresets as ReturnType<typeof vi.fn>
const mockCreatePreset = apiClient.createPreset as ReturnType<typeof vi.fn>
const mockDeletePreset = apiClient.deletePreset as ReturnType<typeof vi.fn>

const samplePresets: Preset[] = [
  {
    id: 'p1',
    name: 'Config A',
    mapping: { x: 'cfg', y: 'prompt', combos: ['seed'] },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'p2',
    name: 'Config B',
    mapping: { slider: 'step', combos: ['cfg', 'seed'] },
    created_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  },
]

const defaultProps = {
  assignments: new Map([
    ['cfg', 'x' as const],
    ['prompt', 'y' as const],
    ['seed', 'combo' as const],
  ]),
  dimensionNames: ['cfg', 'prompt', 'seed'],
}

describe('PresetSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a select element with label', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    expect(wrapper.find('label').text()).toBe('Preset')
    expect(wrapper.find('select').exists()).toBe(true)
  })

  it('populates dropdown with presets after loading', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    const options = wrapper.findAll('option')
    // 1 placeholder + 2 presets
    expect(options).toHaveLength(3)
    expect(options[1].text()).toBe('Config A')
    expect(options[2].text()).toBe('Config B')
  })

  it('shows loading state while fetching', async () => {
    mockGetPresets.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    const select = wrapper.find('select')
    expect((select.element as HTMLSelectElement).disabled).toBe(true)
  })

  it('displays error message when API call fails', async () => {
    mockGetPresets.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Connection lost' })
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    const error = wrapper.find('[role="alert"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toBe('Connection lost')
  })

  it('emits load event with preset and no warnings when selecting a preset with matching dimensions', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    await wrapper.find('select').setValue('p1')

    const emitted = wrapper.emitted('load')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual(samplePresets[0])
    expect(emitted![0][1]).toEqual([]) // no warnings
  })

  it('emits load event with warnings for unmatched dimensions', async () => {
    const presetWithMissing: Preset = {
      id: 'p3',
      name: 'Missing Dims',
      mapping: { x: 'nonexistent', combos: ['also_missing'] },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockGetPresets.mockResolvedValue([presetWithMissing])
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    await wrapper.find('select').setValue('p3')

    const emitted = wrapper.emitted('load')
    expect(emitted).toBeDefined()
    expect(emitted![0][1]).toContain('nonexistent')
    expect(emitted![0][1]).toContain('also_missing')
  })

  it('save button calls createPreset and emits save event', async () => {
    mockGetPresets.mockResolvedValue([])
    const createdPreset: Preset = {
      id: 'new-id',
      name: 'My Preset',
      mapping: { x: 'cfg', y: 'prompt', combos: ['seed'] },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockCreatePreset.mockResolvedValue(createdPreset)
    ;(globalThis.prompt as ReturnType<typeof vi.fn>).mockReturnValue('My Preset')

    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.save-btn').trigger('click')
    await flushPromises()

    expect(mockCreatePreset).toHaveBeenCalledWith('My Preset', {
      x: 'cfg',
      y: 'prompt',
      combos: ['seed'],
    })
    const emitted = wrapper.emitted('save')
    expect(emitted).toBeDefined()
    expect(emitted![0][0]).toEqual(createdPreset)
  })

  it('save button does nothing when prompt is cancelled', async () => {
    mockGetPresets.mockResolvedValue([])
    ;(globalThis.prompt as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.save-btn').trigger('click')
    await flushPromises()

    expect(mockCreatePreset).not.toHaveBeenCalled()
  })

  it('save button is disabled when no assignments', async () => {
    mockGetPresets.mockResolvedValue([])
    const wrapper = mount(PresetSelector, {
      props: { ...defaultProps, assignments: new Map() },
    })
    await flushPromises()

    const saveBtn = wrapper.find('.save-btn')
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('delete button appears when a preset is selected and calls deletePreset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    // No delete button initially
    expect(wrapper.find('.delete-btn').exists()).toBe(false)

    // Select a preset
    await wrapper.find('select').setValue('p1')

    // Delete button appears
    const deleteBtn = wrapper.find('.delete-btn')
    expect(deleteBtn.exists()).toBe(true)

    await deleteBtn.trigger('click')
    await flushPromises()

    expect(mockDeletePreset).toHaveBeenCalledWith('p1')
    const emitted = wrapper.emitted('delete')
    expect(emitted).toBeDefined()
    expect(emitted![0][0]).toBe('p1')
  })

  it('has accessible labels on buttons', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    expect(wrapper.find('.save-btn').attributes('aria-label')).toBe('Save preset')

    await wrapper.find('select').setValue('p1')
    expect(wrapper.find('.delete-btn').attributes('aria-label')).toBe('Delete preset')
  })

  afterAll(() => {
    globalThis.prompt = originalPrompt
  })
})
