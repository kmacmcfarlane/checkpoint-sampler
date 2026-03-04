import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NButton } from 'naive-ui'
import PresetSelector from '../PresetSelector.vue'
import type { Preset, DimensionRole } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getPresets: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
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
const mockUpdatePreset = apiClient.updatePreset as ReturnType<typeof vi.fn>
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
    ['seed', 'none' as const],
  ]),
  dimensionNames: ['cfg', 'prompt', 'seed'],
}

/** Helper to find an NButton by its aria-label attribute. */
function findButton(wrapper: ReturnType<typeof mount>, ariaLabel: string) {
  return wrapper.findAllComponents(NButton).find((b) => b.attributes('aria-label') === ariaLabel)
}

describe('PresetSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a NSelect component with label', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    expect(wrapper.find('label').text()).toBe('Preset')
    expect(wrapper.findComponent(NSelect).exists()).toBe(true)
  })

  it('populates NSelect with preset options after loading', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    const options = select.props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe('Config A')
    expect(options[1].label).toBe('Config B')
  })

  it('shows loading state while fetching', async () => {
    mockGetPresets.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    const select = wrapper.findComponent(NSelect)
    expect(select.props('disabled')).toBe(true)
    expect(select.props('loading')).toBe(true)
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

    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

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

    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p3')
    await nextTick()

    const emitted = wrapper.emitted('load')
    expect(emitted).toBeDefined()
    expect(emitted![0][1]).toContain('nonexistent')
    expect(emitted![0][1]).toContain('also_missing')
  })

  // AC: Save button calls createPreset and emits save event when dirty
  it('save button calls createPreset and emits save event when dirty', async () => {
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

    // Click New to establish a snapshot, then change assignments to make dirty
    const newBtn = findButton(wrapper, 'New preset')!
    await newBtn.trigger('click')
    await nextTick()

    // Simulate parent resetting assignments (pendingSnapshot captures this)
    const emptyAssignments = new Map<string, DimensionRole>([
      ['cfg', 'none'],
      ['prompt', 'none'],
      ['seed', 'none'],
    ])
    await wrapper.setProps({ assignments: emptyAssignments })
    await nextTick()

    // Now modify assignments to make it dirty
    await wrapper.setProps({ assignments: defaultProps.assignments })
    await nextTick()

    const saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(false)
    await saveBtn.trigger('click')
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

    // Click New then modify to make dirty
    const newBtn = findButton(wrapper, 'New preset')!
    await newBtn.trigger('click')
    await nextTick()
    const emptyAssignments = new Map<string, DimensionRole>([
      ['cfg', 'none'],
      ['prompt', 'none'],
      ['seed', 'none'],
    ])
    await wrapper.setProps({ assignments: emptyAssignments })
    await nextTick()
    await wrapper.setProps({ assignments: defaultProps.assignments })
    await nextTick()

    const saveBtn = findButton(wrapper, 'Save preset')!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(mockCreatePreset).not.toHaveBeenCalled()
  })

  // AC: Save button is disabled until the user has modified at least one field (dirty tracking)
  it('save button is disabled when not dirty (no snapshot established)', async () => {
    mockGetPresets.mockResolvedValue([])
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
    })
    await flushPromises()

    const saveBtn = findButton(wrapper, 'Save preset')!
    // No snapshot has been established, so isDirty is false
    expect(saveBtn.props('disabled')).toBe(true)
  })

  // AC: Save button is disabled after loading a preset (clean state)
  it('save button is disabled after loading a preset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    // Select a preset
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    // Simulate parent applying the preset mapping (same assignments as default)
    await wrapper.setProps({ assignments: new Map(defaultProps.assignments) })
    await nextTick()

    const saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(true)
  })

  // AC: Save button enables when dimension assignments are touched (dirty tracking)
  it('save button enables when assignments change after loading a preset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    // Select a preset (triggers pendingSnapshot)
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    // Simulate parent applying the preset mapping
    await wrapper.setProps({ assignments: new Map(defaultProps.assignments) })
    await nextTick()

    // Save should still be disabled (clean)
    let saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(true)

    // Now change an assignment to make it dirty
    const modifiedAssignments = new Map(defaultProps.assignments)
    modifiedAssignments.set('cfg', 'y')
    await wrapper.setProps({ assignments: modifiedAssignments })
    await nextTick()

    saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(false)
  })

  it('delete button appears when a preset is selected and calls deletePreset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, { props: defaultProps })
    await flushPromises()

    // No delete button initially
    expect(findButton(wrapper, 'Delete preset')).toBeUndefined()

    // Select a preset
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    // Delete button appears
    const deleteBtn = findButton(wrapper, 'Delete preset')!
    expect(deleteBtn).toBeDefined()

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

    // AC: New button is always visible
    expect(findButton(wrapper, 'New preset')).toBeDefined()
    expect(findButton(wrapper, 'Save preset')).toBeDefined()

    // Select a preset to show delete button
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    expect(findButton(wrapper, 'Delete preset')).toBeDefined()
  })

  it('auto-loads preset when autoLoadPresetId is provided and preset exists', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, {
      props: { ...defaultProps, autoLoadPresetId: 'p2' },
    })
    await flushPromises()

    const emitted = wrapper.emitted('load')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual(samplePresets[1]) // p2 is the second preset
  })

  it('emits delete event when autoLoadPresetId references a stale preset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets) // only p1 and p2 exist
    const wrapper = mount(PresetSelector, {
      props: { ...defaultProps, autoLoadPresetId: 'p99-stale' },
    })
    await flushPromises()

    const loadEmitted = wrapper.emitted('load')
    expect(loadEmitted).toBeUndefined() // no load event

    const deleteEmitted = wrapper.emitted('delete')
    expect(deleteEmitted).toBeDefined()
    expect(deleteEmitted).toHaveLength(1)
    expect(deleteEmitted![0][0]).toBe('p99-stale')
  })

  it('does not auto-load when autoLoadPresetId is null', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, {
      props: { ...defaultProps, autoLoadPresetId: null },
    })
    await flushPromises()

    const emitted = wrapper.emitted('load')
    expect(emitted).toBeUndefined()
  })

  it('does not auto-load when autoLoadPresetId is undefined', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, {
      props: { ...defaultProps, autoLoadPresetId: undefined },
    })
    await flushPromises()

    const emitted = wrapper.emitted('load')
    expect(emitted).toBeUndefined()
  })

  it('auto-loads preset only once even if presets list changes', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    const wrapper = mount(PresetSelector, {
      props: { ...defaultProps, autoLoadPresetId: 'p1' },
    })
    await flushPromises()

    // First auto-load should happen
    expect(wrapper.emitted('load')).toHaveLength(1)

    // Change the presets (simulate a refetch or update)
    mockGetPresets.mockResolvedValue([...samplePresets])
    await wrapper.vm.$forceUpdate()
    await flushPromises()

    // Auto-load should not trigger again
    expect(wrapper.emitted('load')).toHaveLength(1)
  })

  // AC: A 'New' button is always visible in PresetSelector
  describe('New button', () => {
    it('is always visible', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      const newBtn = findButton(wrapper, 'New preset')
      expect(newBtn).toBeDefined()
    })

    // AC: Clicking 'New' clears the current preset selection and resets dimension assignments
    it('clears selection and emits new event when clicked', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // First select a preset
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()

      // Verify a preset is selected
      expect(select.props('value')).toBe('p1')

      // Click New
      const newBtn = findButton(wrapper, 'New preset')!
      await newBtn.trigger('click')
      await nextTick()

      // Selection should be cleared
      expect(wrapper.findComponent(NSelect).props('value')).toBeNull()

      // 'new' event should be emitted
      const emitted = wrapper.emitted('new')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
    })

    it('enables save after clicking New and then modifying assignments', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // Save is disabled initially (no snapshot)
      let saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)

      // Click New to establish a snapshot
      const newBtn = findButton(wrapper, 'New preset')!
      await newBtn.trigger('click')
      await nextTick()

      // Simulate parent resetting all assignments to 'none' (the New handler in App.vue)
      const resetAssignments = new Map<string, DimensionRole>([
        ['cfg', 'none'],
        ['prompt', 'none'],
        ['seed', 'none'],
      ])
      await wrapper.setProps({ assignments: resetAssignments })
      await nextTick()

      // Save is still disabled (snapshot matches current state)
      saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)

      // Now modify an assignment
      const modifiedAssignments = new Map<string, DimensionRole>([
        ['cfg', 'x'],
        ['prompt', 'none'],
        ['seed', 'none'],
      ])
      await wrapper.setProps({ assignments: modifiedAssignments })
      await nextTick()

      // Save should now be enabled (dirty)
      saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(false)
    })
  })

  describe('dirty tracking', () => {
    // AC: Save button is disabled until the user has modified at least one field on a new or existing preset
    it('save is disabled after saving a preset (snapshot updated)', async () => {
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

      // Click New and modify to make dirty
      const newBtn = findButton(wrapper, 'New preset')!
      await newBtn.trigger('click')
      await nextTick()
      const emptyAssignments = new Map<string, DimensionRole>([
        ['cfg', 'none'],
        ['prompt', 'none'],
        ['seed', 'none'],
      ])
      await wrapper.setProps({ assignments: emptyAssignments })
      await nextTick()
      await wrapper.setProps({ assignments: defaultProps.assignments })
      await nextTick()

      // Save should be enabled (dirty)
      let saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(false)

      // Save the preset
      await saveBtn.trigger('click')
      await flushPromises()

      // After saving, snapshot is updated to current assignments; save should be disabled again
      saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)
    })

    it('delete clears snapshot so save is disabled', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      mockDeletePreset.mockResolvedValue(undefined)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // Select a preset (triggers pendingSnapshot)
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()
      // Simulate parent applying mapping
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments) })
      await nextTick()

      // Delete the selected preset
      const deleteBtn = findButton(wrapper, 'Delete preset')!
      await deleteBtn.trigger('click')
      await flushPromises()

      // Snapshot should be cleared, save disabled
      const saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)
    })

    it('auto-load establishes snapshot so save is disabled after parent applies mapping', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: { ...defaultProps, autoLoadPresetId: 'p1' },
      })
      await flushPromises()

      // Auto-load triggers pendingSnapshot; simulate parent applying the preset mapping
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments) })
      await nextTick()

      const saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)
    })
  })

  // AC: Save and Delete buttons appear below the preset selector dropdown
  describe('layout', () => {
    it('renders Save and Delete in the actions row below the dropdown', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // Select a preset so Delete appears
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()

      // Top row contains label, select, and New button
      const topRow = wrapper.find('.preset-selector__top')
      expect(topRow.exists()).toBe(true)
      expect(topRow.find('label').text()).toBe('Preset')
      expect(topRow.findComponent(NSelect).exists()).toBe(true)

      // Actions row contains Save and Delete
      const actionsRow = wrapper.find('.preset-selector__actions')
      expect(actionsRow.exists()).toBe(true)
      const actionButtons = actionsRow.findAllComponents(NButton)
      const ariaLabels = actionButtons.map((b: VueWrapper) => b.attributes('aria-label'))
      expect(ariaLabels).toContain('Save preset')
      expect(ariaLabels).toContain('Delete preset')
    })

    it('New button is in the top row next to the dropdown', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      const topRow = wrapper.find('.preset-selector__top')
      const topButtons = topRow.findAllComponents(NButton)
      const ariaLabels = topButtons.map((b: VueWrapper) => b.attributes('aria-label'))
      expect(ariaLabels).toContain('New preset')
    })
  })

  // Update button tests (UAT rework B-031)
  describe('Update button', () => {
    /** Helper: select p1, then simulate parent applying its mapping to make dirty. */
    async function loadPresetAndMakeDirty(wrapper: ReturnType<typeof mount>) {
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()
      // Simulate parent applying preset mapping (clean state)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments) })
      await nextTick()
      // Now change an assignment to make dirty
      const modifiedAssignments = new Map(defaultProps.assignments)
      modifiedAssignments.set('cfg', 'y')
      await wrapper.setProps({ assignments: modifiedAssignments })
      await nextTick()
    }

    it('Update button appears when a preset is selected and dirty', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // Not visible before selection
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()

      await loadPresetAndMakeDirty(wrapper)

      expect(findButton(wrapper, 'Update preset')).toBeDefined()
    })

    it('Update button is hidden when no preset is selected', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // No preset selected — button should not be present
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()
    })

    it('Update button is hidden when preset is selected but assignments are clean', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()
      // Simulate parent applying preset mapping (clean state)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments) })
      await nextTick()

      // Clean state: Update button should not be visible
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()
    })

    it('Update button calls apiClient.updatePreset with correct arguments', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const updatedPreset: Preset = {
        ...samplePresets[0],
        mapping: { x: 'prompt', y: 'cfg', combos: ['seed'] },
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockUpdatePreset.mockResolvedValue(updatedPreset)

      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      await loadPresetAndMakeDirty(wrapper)

      const updateBtn = findButton(wrapper, 'Update preset')!
      await updateBtn.trigger('click')
      await flushPromises()

      // Should call updatePreset with preset id, preset name, and current mapping
      expect(mockUpdatePreset).toHaveBeenCalledWith(
        'p1',
        'Config A',
        expect.objectContaining({ combos: expect.any(Array) }),
      )
    })

    it('Update button emits save event with the updated preset', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const updatedPreset: Preset = {
        ...samplePresets[0],
        mapping: { x: 'prompt', y: 'cfg', combos: ['seed'] },
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockUpdatePreset.mockResolvedValue(updatedPreset)

      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      await loadPresetAndMakeDirty(wrapper)

      const updateBtn = findButton(wrapper, 'Update preset')!
      await updateBtn.trigger('click')
      await flushPromises()

      const emitted = wrapper.emitted('save')
      expect(emitted).toBeDefined()
      expect(emitted![0][0]).toEqual(updatedPreset)
    })

    it('Update button disables after successful update (snapshot updated)', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const modifiedAssignments = new Map(defaultProps.assignments)
      modifiedAssignments.set('cfg', 'y')
      const updatedPreset: Preset = {
        ...samplePresets[0],
        mapping: { y: 'cfg', x: 'prompt', combos: ['seed'] },
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockUpdatePreset.mockResolvedValue(updatedPreset)

      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      await loadPresetAndMakeDirty(wrapper)

      // Update is visible (dirty)
      expect(findButton(wrapper, 'Update preset')).toBeDefined()

      const updateBtn = findButton(wrapper, 'Update preset')!
      await updateBtn.trigger('click')
      await flushPromises()

      // After update, snapshot matches current assignments: Update button should hide
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()
    })

    it('Save button still creates a new preset even when an existing preset is selected', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const createdPreset: Preset = {
        id: 'new-id',
        name: 'New Preset',
        mapping: { x: 'prompt', y: 'cfg', combos: ['seed'] },
        created_at: '2025-06-01T00:00:00Z',
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockCreatePreset.mockResolvedValue(createdPreset)
      ;(globalThis.prompt as ReturnType<typeof vi.fn>).mockReturnValue('New Preset')

      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      await loadPresetAndMakeDirty(wrapper)

      const saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(false)
      await saveBtn.trigger('click')
      await flushPromises()

      // Should call createPreset, not updatePreset
      expect(mockCreatePreset).toHaveBeenCalledWith('New Preset', expect.objectContaining({ combos: expect.any(Array) }))
      expect(mockUpdatePreset).not.toHaveBeenCalled()

      const emitted = wrapper.emitted('save')
      expect(emitted).toBeDefined()
      expect(emitted![0][0]).toEqual(createdPreset)
    })
  })

  afterAll(() => {
    globalThis.prompt = originalPrompt
  })
})
