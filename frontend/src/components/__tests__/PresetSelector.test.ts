import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect, NButton, NModal, NInput } from 'naive-ui'
import PresetSelector from '../PresetSelector.vue'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog.vue'
import type { Preset, DimensionRole, FilterMode } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getPresets: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
  },
}))

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
  filterModes: new Map([
    ['cfg', 'multi' as FilterMode],
    ['prompt', 'multi' as FilterMode],
    ['seed', 'single' as FilterMode],
  ]),
  dimensionNames: ['cfg', 'prompt', 'seed'],
}

/** Helper to find an NButton by its aria-label attribute. */
function findButton(wrapper: ReturnType<typeof mount>, ariaLabel: string) {
  return wrapper.findAllComponents(NButton).find((b) => b.attributes('aria-label') === ariaLabel)
}

/**
 * Simulate confirming the ConfirmDeleteDialog.
 * Finds the ConfirmDeleteDialog, finds its confirm button, and clicks it.
 */
async function confirmDeleteDialog(wrapper: ReturnType<typeof mount>) {
  const dialog = wrapper.findComponent(ConfirmDeleteDialog)
  expect(dialog.exists()).toBe(true)
  const confirmBtn = dialog.find('[data-testid="confirm-delete-button"]')
  expect(confirmBtn.exists()).toBe(true)
  await confirmBtn.findComponent(NButton).trigger('click')
  await flushPromises()
}

/**
 * Simulate cancelling the ConfirmDeleteDialog.
 */
async function cancelDeleteDialog(wrapper: ReturnType<typeof mount>) {
  const dialog = wrapper.findComponent(ConfirmDeleteDialog)
  expect(dialog.exists()).toBe(true)
  const cancelBtn = dialog.find('[data-testid="confirm-cancel-button"]')
  expect(cancelBtn.exists()).toBe(true)
  await cancelBtn.findComponent(NButton).trigger('click')
  await flushPromises()
}

/**
 * Open the save dialog and confirm with the given name.
 * Clicks the Save button to open the modal, sets the input value, then confirms.
 */
async function confirmSaveDialog(wrapper: ReturnType<typeof mount>, name: string) {
  const saveBtn = wrapper.find('[data-testid="preset-save-dialog-confirm"]')
  expect(saveBtn.exists()).toBe(true)
  const input = wrapper.findComponent(NInput)
  expect(input.exists()).toBe(true)
  // Set the input value via v-model update event
  input.vm.$emit('update:value', name)
  await nextTick()
  await saveBtn.findComponent(NButton).trigger('click')
  await flushPromises()
}

/**
 * Cancel the save dialog via the Cancel button.
 */
async function cancelSaveDialog(wrapper: ReturnType<typeof mount>) {
  const cancelBtn = wrapper.find('[data-testid="preset-save-dialog-cancel"]')
  expect(cancelBtn.exists()).toBe(true)
  await cancelBtn.findComponent(NButton).trigger('click')
  await flushPromises()
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

    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Click New to establish a snapshot, then change assignments to make dirty
    const newBtn = findButton(wrapper, 'New preset')!
    await newBtn.trigger('click')
    await nextTick()

    // Simulate parent resetting assignments and filter modes (pendingSnapshot captures this)
    const emptyAssignments = new Map<string, DimensionRole>([
      ['cfg', 'none'],
      ['prompt', 'none'],
      ['seed', 'none'],
    ])
    const emptyFilterModes = new Map<string, FilterMode>([
      ['cfg', 'single'],
      ['prompt', 'single'],
      ['seed', 'single'],
    ])
    await wrapper.setProps({ assignments: emptyAssignments, filterModes: emptyFilterModes })
    await nextTick()

    // Now modify assignments to make it dirty
    await wrapper.setProps({ assignments: defaultProps.assignments, filterModes: defaultProps.filterModes })
    await nextTick()

    const saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(false)

    // Click Save opens the modal dialog
    await saveBtn.trigger('click')
    await nextTick()

    // Dialog should be shown
    const modal = wrapper.find('[data-testid="preset-save-dialog"]')
    expect(modal.exists()).toBe(true)

    // Confirm with a name via the dialog
    await confirmSaveDialog(wrapper, 'My Preset')

    expect(mockCreatePreset).toHaveBeenCalledWith('My Preset', {
      x: 'cfg',
      y: 'prompt',
      combos: ['seed'],
    })
    const emitted = wrapper.emitted('save')
    expect(emitted).toBeDefined()
    expect(emitted![0][0]).toEqual(createdPreset)
  })

  it('save button does nothing when dialog is cancelled', async () => {
    mockGetPresets.mockResolvedValue([])

    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
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
    const emptyFilterModes = new Map<string, FilterMode>([
      ['cfg', 'single'],
      ['prompt', 'single'],
      ['seed', 'single'],
    ])
    await wrapper.setProps({ assignments: emptyAssignments, filterModes: emptyFilterModes })
    await nextTick()
    await wrapper.setProps({ assignments: defaultProps.assignments, filterModes: defaultProps.filterModes })
    await nextTick()

    const saveBtn = findButton(wrapper, 'Save preset')!
    await saveBtn.trigger('click')
    await nextTick()

    // Dialog should be open; cancel it
    await cancelSaveDialog(wrapper)

    expect(mockCreatePreset).not.toHaveBeenCalled()
  })

  // AC: FE: Save preset flow uses an NModal input dialog instead of window.prompt
  describe('save name dialog', () => {
    /** Helper to make the component dirty and open the save dialog. */
    async function openSaveDialog(wrapper: ReturnType<typeof mount>) {
      const newBtn = findButton(wrapper, 'New preset')!
      await newBtn.trigger('click')
      await nextTick()
      const emptyAssignments = new Map<string, DimensionRole>([
        ['cfg', 'none'],
        ['prompt', 'none'],
        ['seed', 'none'],
      ])
      const emptyFilterModes = new Map<string, FilterMode>([
        ['cfg', 'single'],
        ['prompt', 'single'],
        ['seed', 'single'],
      ])
      await wrapper.setProps({ assignments: emptyAssignments, filterModes: emptyFilterModes })
      await nextTick()
      await wrapper.setProps({ assignments: defaultProps.assignments, filterModes: defaultProps.filterModes })
      await nextTick()

      const saveBtn = findButton(wrapper, 'Save preset')!
      await saveBtn.trigger('click')
      await nextTick()
    }

    // AC1: Save preset flow uses an NModal input dialog instead of window.prompt
    it('clicking Save opens an NModal dialog with a text input', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)

      const modal = wrapper.find('[data-testid="preset-save-dialog"]')
      expect(modal.exists()).toBe(true)
      // Find the save dialog NModal (the second NModal; first belongs to ConfirmDeleteDialog)
      const allModals = wrapper.findAllComponents(NModal)
      const saveModal = allModals.find((m) => m.props('show') === true)
      expect(saveModal).toBeDefined()

      const input = wrapper.find('[data-testid="preset-save-dialog-input"]')
      expect(input.exists()).toBe(true)
    })

    // AC2: Dialog is consistent with ConfirmDeleteDialog pattern (preset="card", cancel/confirm)
    it('dialog has confirm and cancel buttons', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)

      expect(wrapper.find('[data-testid="preset-save-dialog-confirm"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="preset-save-dialog-cancel"]').exists()).toBe(true)
    })

    // AC3: Cancel action works correctly
    it('cancel closes the dialog without calling createPreset', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)

      // Verify save dialog is open (find the modal that is currently shown)
      const allModalsBeforeCancel = wrapper.findAllComponents(NModal)
      const saveModalBeforeCancel = allModalsBeforeCancel.find((m) => m.props('show') === true)
      expect(saveModalBeforeCancel).toBeDefined()

      await cancelSaveDialog(wrapper)

      expect(mockCreatePreset).not.toHaveBeenCalled()
      // Modal should be closed: no NModal should have show=true
      const allModalsAfterCancel = wrapper.findAllComponents(NModal)
      const anyShownModal = allModalsAfterCancel.find((m) => m.props('show') === true)
      expect(anyShownModal).toBeUndefined()
    })

    // Testing scenario: Empty name is rejected (confirm button disabled)
    it('confirm button is disabled when the input is empty', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)

      const confirmBtn = wrapper.find('[data-testid="preset-save-dialog-confirm"]').findComponent(NButton)
      // Input is empty by default — confirm should be disabled
      expect(confirmBtn.props('disabled')).toBe(true)
    })

    // Testing scenario: Whitespace-only name is rejected (confirm button disabled)
    it('confirm button is disabled when the input contains only whitespace', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)

      // Type whitespace only
      const input = wrapper.findComponent(NInput)
      input.vm.$emit('update:value', '   ')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-save-dialog-confirm"]').findComponent(NButton)
      expect(confirmBtn.props('disabled')).toBe(true)
    })

    // Testing scenario: Non-empty name enables the confirm button
    it('confirm button is enabled when a non-empty name is entered', async () => {
      mockGetPresets.mockResolvedValue([])
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)

      // Type a valid name
      const input = wrapper.findComponent(NInput)
      input.vm.$emit('update:value', 'My Preset')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-save-dialog-confirm"]').findComponent(NButton)
      expect(confirmBtn.props('disabled')).toBe(false)
    })

    // AC3: Confirm action works correctly — calls createPreset and closes dialog
    it('confirming with a valid name calls createPreset and closes the dialog', async () => {
      mockGetPresets.mockResolvedValue([])
      const createdPreset: Preset = {
        id: 'new-id',
        name: 'Saved Name',
        mapping: { x: 'cfg', y: 'prompt', combos: ['seed'] },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }
      mockCreatePreset.mockResolvedValue(createdPreset)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await openSaveDialog(wrapper)
      await confirmSaveDialog(wrapper, 'Saved Name')

      expect(mockCreatePreset).toHaveBeenCalledWith('Saved Name', expect.objectContaining({ combos: expect.any(Array) }))
      // Modal should be closed after confirm: no NModal should have show=true
      const allModals = wrapper.findAllComponents(NModal)
      const anyShownModal = allModals.find((m) => m.props('show') === true)
      expect(anyShownModal).toBeUndefined()
    })
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

    // Simulate parent applying the preset mapping (same assignments and filter modes as default)
    await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
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

    // Simulate parent applying the preset mapping (same assignments and filter modes as default)
    await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
    await nextTick()

    // Save should still be disabled (clean)
    let saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(true)

    // Now change an assignment to make it dirty
    const modifiedAssignments = new Map(defaultProps.assignments)
    modifiedAssignments.set('cfg', 'y')
    await wrapper.setProps({ assignments: modifiedAssignments, filterModes: new Map(defaultProps.filterModes) })
    await nextTick()

    saveBtn = findButton(wrapper, 'Save preset')!
    expect(saveBtn.props('disabled')).toBe(false)
  })

  // AC1: FE: Delete button on dimension mapping preset shows the standard confirmation dialog
  it('delete button appears when a preset is selected and shows confirmation dialog on click', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
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

    // AC1: Clicking delete opens the confirmation dialog — does NOT call deletePreset yet
    await deleteBtn.trigger('click')
    await nextTick()

    expect(mockDeletePreset).not.toHaveBeenCalled()

    // ConfirmDeleteDialog should now be shown
    const dialog = wrapper.findComponent(ConfirmDeleteDialog)
    expect(dialog.exists()).toBe(true)
    const modal = dialog.findComponent(NModal)
    expect(modal.props('show')).toBe(true)

    // AC2: Confirming delete removes the preset
    await confirmDeleteDialog(wrapper)

    expect(mockDeletePreset).toHaveBeenCalledWith('p1')
    const emitted = wrapper.emitted('delete')
    expect(emitted).toBeDefined()
    expect(emitted![0][0]).toBe('p1')
  })

  // AC1: FE: Confirming delete removes the preset; canceling does not
  it('cancel in confirmation dialog does not call deletePreset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select a preset
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    // Click delete to open dialog
    const deleteBtn = findButton(wrapper, 'Delete preset')!
    await deleteBtn.trigger('click')
    await nextTick()

    // Cancel the dialog
    await cancelDeleteDialog(wrapper)

    // deletePreset should NOT have been called
    expect(mockDeletePreset).not.toHaveBeenCalled()

    // Preset should still be selected
    const select2 = wrapper.findComponent(NSelect)
    expect(select2.props('value')).toBe('p1')
  })

  // AC2 + AC3: FE: Confirming delete removes the preset; selector auto-selects the first available preset when no MRU history
  it('confirming delete removes the selected preset and auto-selects the first available preset (no MRU history)', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select p1 (no prior MRU history for p2)
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    expect(select.props('value')).toBe('p1')

    // Click delete then confirm
    const deleteBtn = findButton(wrapper, 'Delete preset')!
    await deleteBtn.trigger('click')
    await nextTick()
    await confirmDeleteDialog(wrapper)

    // AC3: After deleting p1, selector auto-selects the first remaining preset (p2)
    expect(wrapper.findComponent(NSelect).props('value')).toBe('p2')

    // p1 should be removed from the options list
    const options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string; value: string }>
    expect(options.find((o) => o.value === 'p1')).toBeUndefined()

    // AC3: Delete button is still visible because p2 is now selected
    expect(findButton(wrapper, 'Delete preset')).toBeDefined()

    // load event emitted for the auto-selected preset
    const loadEmitted = wrapper.emitted('load')
    expect(loadEmitted).toBeDefined()
    expect((loadEmitted![loadEmitted!.length - 1][0] as Preset).id).toBe('p2')
  })

  // AC3: After deleting a preset, auto-selects the MRU preset if available
  it('confirming delete auto-selects the most recently used preset when MRU history is available', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const select = wrapper.findComponent(NSelect)

    // Visit p2 first, then p1 — so p2 is MRU before p1
    select.vm.$emit('update:value', 'p2')
    await nextTick()
    select.vm.$emit('update:value', 'p1')
    await nextTick()

    // p1 is now selected and p2 was visited most recently before p1
    expect(select.props('value')).toBe('p1')

    // Delete p1
    const deleteBtn = findButton(wrapper, 'Delete preset')!
    await deleteBtn.trigger('click')
    await nextTick()
    await confirmDeleteDialog(wrapper)

    // AC3: p2 is the most recently used preset that still exists → auto-selected
    expect(wrapper.findComponent(NSelect).props('value')).toBe('p2')

    // load event emitted for p2
    const loadEmitted = wrapper.emitted('load')
    expect(loadEmitted).toBeDefined()
    expect((loadEmitted![loadEmitted!.length - 1][0] as Preset).id).toBe('p2')
  })

  // AC3 + Testing scenario: Deleting the last remaining preset resets to no selection
  it('deleting the last remaining preset resets to no selection', async () => {
    const lastPreset: Preset = {
      id: 'last',
      name: 'Last Preset',
      mapping: { x: 'cfg', combos: [] },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockGetPresets.mockResolvedValue([lastPreset])
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select the only preset
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'last')
    await nextTick()

    // Confirm delete
    const deleteBtn = findButton(wrapper, 'Delete preset')!
    await deleteBtn.trigger('click')
    await nextTick()
    await confirmDeleteDialog(wrapper)

    // Preset list should be empty
    const options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(0)

    // Selector should be reset
    expect(wrapper.findComponent(NSelect).props('value')).toBeNull()

    // Delete button should be gone
    expect(findButton(wrapper, 'Delete preset')).toBeUndefined()

    // delete event emitted
    expect(wrapper.emitted('delete')).toBeDefined()
    expect(wrapper.emitted('delete')![0][0]).toBe('last')
  })

  // Testing scenario: Deleting a preset that is currently selected (verifies auto-selection occurs)
  it('deleting a currently selected preset auto-selects the first available preset', async () => {
    mockGetPresets.mockResolvedValue(samplePresets)
    mockDeletePreset.mockResolvedValue(undefined)
    const wrapper = mount(PresetSelector, {
      props: defaultProps,
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select p1 and establish a snapshot (simulating parent applying the preset)
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', 'p1')
    await nextTick()
    await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
    await nextTick()

    // p1 is selected; now delete it
    const deleteBtn = findButton(wrapper, 'Delete preset')!
    await deleteBtn.trigger('click')
    await nextTick()
    await confirmDeleteDialog(wrapper)

    // Selector should auto-select p2 (first available since no MRU for p2)
    expect(wrapper.findComponent(NSelect).props('value')).toBe('p2')

    // load event should have been emitted for p2
    const loadEmitted = wrapper.emitted('load')
    expect(loadEmitted).toBeDefined()
    expect((loadEmitted![loadEmitted!.length - 1][0] as Preset).id).toBe('p2')
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

      // Simulate parent resetting all assignments to 'none' and filter modes to 'single' (the New handler in App.vue)
      const resetAssignments = new Map<string, DimensionRole>([
        ['cfg', 'none'],
        ['prompt', 'none'],
        ['seed', 'none'],
      ])
      const resetFilterModes = new Map<string, FilterMode>([
        ['cfg', 'single'],
        ['prompt', 'single'],
        ['seed', 'single'],
      ])
      await wrapper.setProps({ assignments: resetAssignments, filterModes: resetFilterModes })
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
      const modifiedFilterModes = new Map<string, FilterMode>([
        ['cfg', 'multi'],
        ['prompt', 'single'],
        ['seed', 'single'],
      ])
      await wrapper.setProps({ assignments: modifiedAssignments, filterModes: modifiedFilterModes })
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

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
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
      const emptyFilterModes = new Map<string, FilterMode>([
        ['cfg', 'single'],
        ['prompt', 'single'],
        ['seed', 'single'],
      ])
      await wrapper.setProps({ assignments: emptyAssignments, filterModes: emptyFilterModes })
      await nextTick()
      await wrapper.setProps({ assignments: defaultProps.assignments, filterModes: defaultProps.filterModes })
      await nextTick()

      // Save should be enabled (dirty)
      let saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(false)

      // Click Save to open the dialog, then confirm with a name
      await saveBtn.trigger('click')
      await nextTick()
      await confirmSaveDialog(wrapper, 'My Preset')

      // After saving, snapshot is updated to current assignments; save should be disabled again
      saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)
    })

    it('delete clears snapshot so save is disabled', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      mockDeletePreset.mockResolvedValue(undefined)
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a preset (triggers pendingSnapshot)
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()
      // Simulate parent applying mapping (assignments + filter modes)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // Delete the selected preset (now goes through dialog)
      const deleteBtn = findButton(wrapper, 'Delete preset')!
      await deleteBtn.trigger('click')
      await nextTick()
      await confirmDeleteDialog(wrapper)

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

      // Auto-load triggers pendingSnapshot; simulate parent applying the preset mapping and filter modes
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      const saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)
    })

    // AC1, AC3: After auto-load, changing a filter mode (single→multi) marks the preset dirty
    // This is the bug scenario: role stays 'none' but filter mode changes should still trigger dirty
    it('changing filter mode after auto-load marks preset dirty (shows Update button)', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: { ...defaultProps, autoLoadPresetId: 'p1' },
      })
      await flushPromises()

      // Auto-load triggers pendingSnapshot; simulate parent applying preset mapping and filter modes
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // Verify clean state — Update button should not be visible
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()
      const saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)

      // Simulate changing a filter mode: 'seed' from 'single' → 'multi'
      // (role stays 'none', so assignments map is unchanged — only filterModes changes)
      const changedFilterModes = new Map(defaultProps.filterModes)
      changedFilterModes.set('seed', 'multi')
      await wrapper.setProps({ filterModes: changedFilterModes })
      await nextTick()

      // AC1: Update button must appear immediately on first change
      expect(findButton(wrapper, 'Update preset')).toBeDefined()
      // AC2: Save button also enabled (dirty)
      expect(saveBtn.props('disabled')).toBe(false)
    })

    // AC2: Dirty tracking correctly compares all selector values including filter modes
    it('filter mode change from hide to single marks preset dirty after manual preset load', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      // Select a preset manually (triggers pendingSnapshot)
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()

      // Simulate parent applying preset mapping and filter modes
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // Clean state
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()

      // Change filter mode of 'seed' from 'single' to 'hide' — role stays 'none'
      const changedFilterModes = new Map(defaultProps.filterModes)
      changedFilterModes.set('seed', 'hide')
      await wrapper.setProps({ filterModes: changedFilterModes })
      await nextTick()

      // Should be dirty now — Update button should appear
      expect(findButton(wrapper, 'Update preset')).toBeDefined()
    })

    // AC3: Update button appears immediately on first change, not requiring a second interaction
    it('first filter mode change immediately marks dirty without requiring second interaction', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: { ...defaultProps, autoLoadPresetId: 'p1' },
      })
      await flushPromises()

      // Apply parent mapping (establishes snapshot)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // Only ONE change — should immediately be dirty
      const changedFilterModes = new Map(defaultProps.filterModes)
      changedFilterModes.set('seed', 'multi')
      await wrapper.setProps({ filterModes: changedFilterModes })
      await nextTick()

      // Update button should appear after the very first change
      expect(findButton(wrapper, 'Update preset')).toBeDefined()
    })

    // AC4: Unit test for reverting filter mode back to snapshot value (no longer dirty)
    it('reverting filter mode to snapshot value removes dirty state', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: { ...defaultProps, autoLoadPresetId: 'p1' },
      })
      await flushPromises()

      // Apply parent mapping (establishes snapshot with filterModes from defaultProps)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // Change filter mode to make dirty
      const changedFilterModes = new Map(defaultProps.filterModes)
      changedFilterModes.set('seed', 'multi')
      await wrapper.setProps({ filterModes: changedFilterModes })
      await nextTick()

      // Dirty — Update button visible
      expect(findButton(wrapper, 'Update preset')).toBeDefined()

      // Revert filter mode back to original value
      await wrapper.setProps({ filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // No longer dirty — Update button should hide
      expect(findButton(wrapper, 'Update preset')).toBeUndefined()
    })

    // AC1, AC2 (B-091): After saving a manually selected (via dropdown) preset, Save button becomes disabled
    it('save is disabled after saving a new preset from a manually selected preset context', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const createdPreset: Preset = {
        id: 'new-id',
        name: 'Forked Preset',
        mapping: { x: 'prompt', y: 'cfg', combos: ['seed'] },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }
      mockCreatePreset.mockResolvedValue(createdPreset)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Manually select a preset via the dropdown (triggers pendingSnapshot)
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()
      // Simulate parent applying the preset mapping and filter modes
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()

      // Clean state after load — save should be disabled
      let saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(true)

      // Modify filter modes to make dirty (same as the failing E2E scenario)
      const modifiedFilterModes = new Map(defaultProps.filterModes)
      modifiedFilterModes.set('seed', 'multi')
      await wrapper.setProps({ filterModes: modifiedFilterModes })
      await nextTick()

      // Save should be enabled (dirty)
      saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(false)

      // Click Save to open the dialog, then confirm with a name
      await saveBtn.trigger('click')
      await nextTick()
      await confirmSaveDialog(wrapper, 'Forked Preset')

      // AC1, AC2 (B-091): After saving, snapshot is updated to current state; save should be disabled again
      saveBtn = findButton(wrapper, 'Save preset')!
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
      // Simulate parent applying preset mapping and filter modes (clean state)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
      await nextTick()
      // Now change an assignment to make dirty
      const modifiedAssignments = new Map(defaultProps.assignments)
      modifiedAssignments.set('cfg', 'y')
      await wrapper.setProps({ assignments: modifiedAssignments, filterModes: new Map(defaultProps.filterModes) })
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
      // Simulate parent applying preset mapping and filter modes (clean state)
      await wrapper.setProps({ assignments: new Map(defaultProps.assignments), filterModes: new Map(defaultProps.filterModes) })
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

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await loadPresetAndMakeDirty(wrapper)

      const saveBtn = findButton(wrapper, 'Save preset')!
      expect(saveBtn.props('disabled')).toBe(false)

      // Open save dialog and confirm
      await saveBtn.trigger('click')
      await nextTick()
      await confirmSaveDialog(wrapper, 'New Preset')

      // Should call createPreset, not updatePreset
      expect(mockCreatePreset).toHaveBeenCalledWith('New Preset', expect.objectContaining({ combos: expect.any(Array) }))
      expect(mockUpdatePreset).not.toHaveBeenCalled()

      const emitted = wrapper.emitted('save')
      expect(emitted).toBeDefined()
      expect(emitted![0][0]).toEqual(createdPreset)
    })
  })

  // AC1, AC2, AC3: Inline rename flow
  describe('Rename button', () => {
    /** Helper: select preset p1 and simulate parent applying mapping (clean state). */
    async function selectPreset(wrapper: ReturnType<typeof mount>) {
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'p1')
      await nextTick()
      await wrapper.setProps({
        assignments: new Map(defaultProps.assignments),
        filterModes: new Map(defaultProps.filterModes),
      })
      await nextTick()
    }

    /** Open the rename dialog for the selected preset. */
    async function openRenameDialog(wrapper: ReturnType<typeof mount>) {
      const renameBtn = findButton(wrapper, 'Rename preset')!
      expect(renameBtn).toBeDefined()
      await renameBtn.trigger('click')
      await nextTick()
    }

    // AC1: Inline rename affordance on the preset name field
    it('Rename button appears when a preset is selected', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Not visible before selection
      expect(findButton(wrapper, 'Rename preset')).toBeUndefined()

      await selectPreset(wrapper)

      // AC1: Rename button is now visible
      expect(findButton(wrapper, 'Rename preset')).toBeDefined()
    })

    // AC1: Rename button is not visible when no preset is selected
    it('Rename button is not visible when no preset is selected', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, { props: defaultProps })
      await flushPromises()

      expect(findButton(wrapper, 'Rename preset')).toBeUndefined()
    })

    // AC1: Clicking Rename opens a dialog pre-filled with the current preset name
    it('clicking Rename opens a dialog pre-filled with the current preset name', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      // AC1: The rename dialog is open
      const renameDialog = wrapper.find('[data-testid="preset-rename-dialog"]')
      expect(renameDialog.exists()).toBe(true)

      // AC1: The dialog input is pre-filled with the current preset name ("Config A")
      const allModals = wrapper.findAllComponents(NModal)
      const renameModal = allModals.find((m) => m.props('show') === true)
      expect(renameModal).toBeDefined()

      // The input value should be the preset's current name
      const allInputs = wrapper.findAllComponents(NInput)
      // The rename dialog input is data-testid="preset-rename-dialog-input"
      const renameInput = wrapper.find('[data-testid="preset-rename-dialog-input"]')
      expect(renameInput.exists()).toBe(true)
      // Find the NInput that corresponds to the rename dialog
      const renameNInput = allInputs.find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )
      expect(renameNInput).toBeDefined()
      expect(renameNInput!.props('value')).toBe('Config A')
    })

    // AC1: Rename dialog has confirm and cancel buttons
    it('rename dialog has confirm and cancel buttons', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      expect(wrapper.find('[data-testid="preset-rename-dialog-confirm"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="preset-rename-dialog-cancel"]').exists()).toBe(true)
    })

    // AC2: Renaming updates the preset without requiring Save-As
    it('confirming rename calls updatePreset with new name and existing mapping', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const renamedPreset: Preset = {
        ...samplePresets[0],
        name: 'Renamed Config A',
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockUpdatePreset.mockResolvedValue(renamedPreset)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      // AC2: Update the name in the dialog
      const renameNInput = wrapper.findAllComponents(NInput).find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )!
      renameNInput.vm.$emit('update:value', 'Renamed Config A')
      await nextTick()

      // Confirm
      const confirmBtn = wrapper.find('[data-testid="preset-rename-dialog-confirm"]')
      await confirmBtn.findComponent(NButton).trigger('click')
      await flushPromises()

      // AC2: updatePreset called with preset id, new name, and existing mapping (no Save-As)
      expect(mockUpdatePreset).toHaveBeenCalledWith(
        'p1',
        'Renamed Config A',
        samplePresets[0].mapping,
      )
      expect(mockCreatePreset).not.toHaveBeenCalled()
    })

    // AC2: After confirming rename, the NSelect options show the updated name
    it('after confirming rename, the NSelect options show the updated name', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const renamedPreset: Preset = {
        ...samplePresets[0],
        name: 'Renamed Config A',
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockUpdatePreset.mockResolvedValue(renamedPreset)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      const renameNInput = wrapper.findAllComponents(NInput).find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )!
      renameNInput.vm.$emit('update:value', 'Renamed Config A')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-rename-dialog-confirm"]')
      await confirmBtn.findComponent(NButton).trigger('click')
      await flushPromises()

      // AC2: The NSelect options should reflect the new name
      const options = wrapper.findComponent(NSelect).props('options') as Array<{ label: string; value: string }>
      const renamedOption = options.find((o) => o.value === 'p1')
      expect(renamedOption?.label).toBe('Renamed Config A')
    })

    // AC2: After confirming rename, the save event is emitted
    it('after confirming rename, save event is emitted with the renamed preset', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)
      const renamedPreset: Preset = {
        ...samplePresets[0],
        name: 'Renamed Config A',
        updated_at: '2025-06-01T00:00:00Z',
      }
      mockUpdatePreset.mockResolvedValue(renamedPreset)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      const renameNInput = wrapper.findAllComponents(NInput).find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )!
      renameNInput.vm.$emit('update:value', 'Renamed Config A')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-rename-dialog-confirm"]')
      await confirmBtn.findComponent(NButton).trigger('click')
      await flushPromises()

      // AC2: save event emitted with the renamed preset
      const saveEmitted = wrapper.emitted('save')
      expect(saveEmitted).toBeDefined()
      expect(saveEmitted![0][0]).toEqual(renamedPreset)
    })

    // AC3: Cancelling the rename dialog does not call updatePreset
    it('cancelling rename dialog does not call updatePreset', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      // Cancel without confirming
      const cancelBtn = wrapper.find('[data-testid="preset-rename-dialog-cancel"]')
      await cancelBtn.findComponent(NButton).trigger('click')
      await flushPromises()

      expect(mockUpdatePreset).not.toHaveBeenCalled()

      // Modal should be closed
      const allModals = wrapper.findAllComponents(NModal)
      const anyShownModal = allModals.find((m) => m.props('show') === true)
      expect(anyShownModal).toBeUndefined()
    })

    // AC3: Confirm button disabled when name is empty
    it('confirm button is disabled when rename input is empty', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      // Clear the input
      const renameNInput = wrapper.findAllComponents(NInput).find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )!
      renameNInput.vm.$emit('update:value', '')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-rename-dialog-confirm"]').findComponent(NButton)
      expect(confirmBtn.props('disabled')).toBe(true)
    })

    // AC3: Confirm button disabled when name is whitespace-only
    it('confirm button is disabled when rename input is whitespace-only', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      const renameNInput = wrapper.findAllComponents(NInput).find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )!
      renameNInput.vm.$emit('update:value', '   ')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-rename-dialog-confirm"]').findComponent(NButton)
      expect(confirmBtn.props('disabled')).toBe(true)
    })

    // AC3: Confirm button enabled when a non-empty name is entered
    it('confirm button is enabled when a non-empty name is entered in rename dialog', async () => {
      mockGetPresets.mockResolvedValue(samplePresets)

      const wrapper = mount(PresetSelector, {
        props: defaultProps,
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await selectPreset(wrapper)
      await openRenameDialog(wrapper)

      const renameNInput = wrapper.findAllComponents(NInput).find((inp) =>
        inp.attributes('data-testid') === 'preset-rename-dialog-input'
      )!
      renameNInput.vm.$emit('update:value', 'New Name')
      await nextTick()

      const confirmBtn = wrapper.find('[data-testid="preset-rename-dialog-confirm"]').findComponent(NButton)
      expect(confirmBtn.props('disabled')).toBe(false)
    })
  })

})
