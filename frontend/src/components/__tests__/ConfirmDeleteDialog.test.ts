import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NModal, NButton, NCheckbox } from 'naive-ui'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog.vue'

// enableAutoUnmount is configured globally in vitest.setup.ts

describe('ConfirmDeleteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mountDialog(overrides: Partial<{
    show: boolean
    title: string
    description: string
    checkboxLabel: string
    checkboxChecked: boolean
    confirmLabel: string
  }> = {}) {
    return mount(ConfirmDeleteDialog, {
      props: {
        show: true,
        title: 'Delete Item',
        description: 'Are you sure you want to delete this item?',
        ...overrides,
      },
      global: {
        stubs: { Teleport: true },
      },
    })
  }

  // AC: FE: Reusable ConfirmDeleteDialog with configurable title, description, and optional checkbox
  it('renders the dialog with title and description when shown', () => {
    const wrapper = mountDialog({
      title: 'Delete Study',
      description: 'This action cannot be undone.',
    })

    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('show')).toBe(true)
    expect(modal.props('title')).toBe('Delete Study')

    const desc = wrapper.find('[data-testid="confirm-delete-description"]')
    expect(desc.exists()).toBe(true)
    expect(desc.text()).toBe('This action cannot be undone.')
  })

  // AC: FE: Reusable ConfirmDeleteDialog with configurable title, description, and optional checkbox
  it('does not render checkbox when checkboxLabel is not provided', () => {
    const wrapper = mountDialog()
    const checkbox = wrapper.find('[data-testid="confirm-delete-checkbox"]')
    expect(checkbox.exists()).toBe(false)
  })

  // AC: FE: Optional checkbox prop for additional options (e.g., 'Also delete sample data')
  it('renders checkbox with label when checkboxLabel is provided', () => {
    const wrapper = mountDialog({ checkboxLabel: 'Also delete sample data' })

    const checkbox = wrapper.find('[data-testid="confirm-delete-checkbox"]')
    expect(checkbox.exists()).toBe(true)
    expect(checkbox.text()).toContain('Also delete sample data')
  })

  // AC: FE: Optional checkbox prop — initial checked state reflects checkboxChecked prop
  it('initializes checkbox as unchecked by default', () => {
    const wrapper = mountDialog({ checkboxLabel: 'Also delete sample data' })

    const checkbox = wrapper.findComponent(NCheckbox)
    expect(checkbox.props('checked')).toBe(false)
  })

  // AC: FE: Optional checkbox prop — initial checked state reflects checkboxChecked prop
  it('initializes checkbox as checked when checkboxChecked is true', () => {
    const wrapper = mountDialog({
      checkboxLabel: 'Also delete sample data',
      checkboxChecked: true,
    })

    const checkbox = wrapper.findComponent(NCheckbox)
    expect(checkbox.props('checked')).toBe(true)
  })

  // AC: FE: Red 'Yes, Delete' button triggers the delete callback
  it('emits confirm with checkbox state false when no checkbox and Yes Delete is clicked', async () => {
    const wrapper = mountDialog()

    const confirmBtn = wrapper.find('[data-testid="confirm-delete-button"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.findComponent(NButton).trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('confirm')![0]).toEqual([false])
    expect(wrapper.emitted('update:show')).toHaveLength(1)
    expect(wrapper.emitted('update:show')![0]).toEqual([false])
  })

  // AC: FE: Red 'Yes, Delete' button triggers the delete callback
  // AC: FE: Checkbox state is passed through to confirm callback
  it('emits confirm with checkbox state true when checkbox is checked and Yes Delete is clicked', async () => {
    const wrapper = mountDialog({
      checkboxLabel: 'Also delete sample data',
      checkboxChecked: false,
    })

    // Toggle the checkbox
    const checkbox = wrapper.findComponent(NCheckbox)
    await checkbox.vm.$emit('update:checked', true)
    await flushPromises()

    const confirmBtn = wrapper.find('[data-testid="confirm-delete-button"]')
    await confirmBtn.findComponent(NButton).trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('confirm')![0]).toEqual([true])
  })

  // AC: FE: Checkbox state is passed through to confirm callback
  it('emits confirm with checkbox state false when checkbox remains unchecked', async () => {
    const wrapper = mountDialog({
      checkboxLabel: 'Also delete sample data',
      checkboxChecked: false,
    })

    const confirmBtn = wrapper.find('[data-testid="confirm-delete-button"]')
    await confirmBtn.findComponent(NButton).trigger('click')

    expect(wrapper.emitted('confirm')![0]).toEqual([false])
  })

  // AC: FE: Clicking Cancel aborts the delete
  it('emits cancel and update:show=false when Cancel button is clicked', async () => {
    const wrapper = mountDialog()

    const cancelBtn = wrapper.find('[data-testid="confirm-cancel-button"]')
    expect(cancelBtn.exists()).toBe(true)
    await cancelBtn.findComponent(NButton).trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('update:show')).toHaveLength(1)
    expect(wrapper.emitted('update:show')![0]).toEqual([false])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  // AC: FE: Clicking outside the dialog aborts the delete
  it('emits cancel and update:show=false when modal closes via mask (update:show=false from NModal)', async () => {
    const wrapper = mountDialog()

    // Simulate NModal emitting update:show=false (mask click or close button)
    const modal = wrapper.findComponent(NModal)
    await modal.vm.$emit('update:show', false)

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('update:show')).toHaveLength(1)
    expect(wrapper.emitted('update:show')![0]).toEqual([false])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  // AC: FE: Reusable ConfirmDeleteDialog — dialog does not show when show=false
  it('passes show=false to NModal when show prop is false', () => {
    const wrapper = mountDialog({ show: false })

    const modal = wrapper.findComponent(NModal)
    expect(modal.props('show')).toBe(false)
  })

  // AC: FE: Checkbox state resets to prop value when dialog reopens
  it('resets internal checkbox state to prop value when dialog reopens', async () => {
    const wrapper = mountDialog({
      show: true,
      checkboxLabel: 'Also delete sample data',
      checkboxChecked: false,
    })

    // Check the checkbox internally
    const checkbox = wrapper.findComponent(NCheckbox)
    await checkbox.vm.$emit('update:checked', true)
    await flushPromises()
    expect(checkbox.props('checked')).toBe(true)

    // Close and reopen the dialog — internal state should reset
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await flushPromises()

    // After reopening, should revert to checkboxChecked=false
    expect(wrapper.findComponent(NCheckbox).props('checked')).toBe(false)
  })

  // AC: FE: Confirm button is visually a red/error button
  it('renders the Yes Delete button as error type (red)', () => {
    const wrapper = mountDialog()

    const confirmBtn = wrapper.find('[data-testid="confirm-delete-button"]')
    const nButton = confirmBtn.findComponent(NButton)
    expect(nButton.props('type')).toBe('error')
  })

  // AC: FE: mask-closable is enabled on the modal
  it('sets mask-closable to true on the NModal', () => {
    const wrapper = mountDialog()

    const modal = wrapper.findComponent(NModal)
    expect(modal.props('maskClosable')).toBe(true)
  })

  // AC: FE: ConfirmDeleteDialog accepts a confirmLabel prop to customize the button text
  it('renders default button text "Yes, Delete" when confirmLabel is not provided', () => {
    const wrapper = mountDialog()

    const confirmBtn = wrapper.find('[data-testid="confirm-delete-button"]')
    expect(confirmBtn.text()).toBe('Yes, Delete')
  })

  // AC: FE: ConfirmDeleteDialog accepts a confirmLabel prop to customize the button text
  it('renders custom button text when confirmLabel prop is provided', () => {
    const wrapper = mountDialog({ confirmLabel: 'Yes, Regenerate' })

    const confirmBtn = wrapper.find('[data-testid="confirm-delete-button"]')
    expect(confirmBtn.text()).toBe('Yes, Regenerate')
  })
})
