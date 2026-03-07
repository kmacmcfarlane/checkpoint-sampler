import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NModal, NButton, NAlert, NSwitch } from 'naive-ui'
import SettingsDialog from '../SettingsDialog.vue'

// Mock the API client
vi.mock('../../api/client', () => ({
  apiClient: {
    getDemoStatus: vi.fn(),
    installDemo: vi.fn(),
    uninstallDemo: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'
const mockedClient = vi.mocked(apiClient)

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mountDialog(show = true, isDark = false, debugMode = false) {
    return mount(SettingsDialog, {
      props: { show, isDark, debugMode },
      global: {
        stubs: { Teleport: true },
      },
    })
  }

  // AC: FE — A settings dialog allows re-adding the demo dataset after deletion
  it('renders the settings dialog with demo section when shown', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: true })
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.findComponent(NModal).exists()).toBe(true)
    const section = wrapper.find('[data-testid="demo-section"]')
    expect(section.exists()).toBe(true)
  })

  // AC: FE — Demo dataset is visible and browsable out of the box
  it('shows installed status when demo is installed', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: true })
    const wrapper = mountDialog(true)
    await flushPromises()

    const status = wrapper.find('[data-testid="demo-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('Installed')
  })

  it('shows not installed status when demo is not installed', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true)
    await flushPromises()

    const status = wrapper.find('[data-testid="demo-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('Not installed')
  })

  // AC: FE — Demo dataset is deletable from the UI
  it('shows Delete Demo button when demo is installed', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: true })
    const wrapper = mountDialog(true)
    await flushPromises()

    const deleteBtn = wrapper.find('[data-testid="demo-delete-button"]')
    expect(deleteBtn.exists()).toBe(true)

    const restoreBtn = wrapper.find('[data-testid="demo-restore-button"]')
    expect(restoreBtn.exists()).toBe(false)
  })

  // AC: FE — A settings dialog allows re-adding the demo dataset after deletion
  it('shows Restore Demo button when demo is not installed', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true)
    await flushPromises()

    const restoreBtn = wrapper.find('[data-testid="demo-restore-button"]')
    expect(restoreBtn.exists()).toBe(true)

    const deleteBtn = wrapper.find('[data-testid="demo-delete-button"]')
    expect(deleteBtn.exists()).toBe(false)
  })

  it('calls uninstallDemo and emits demo-changed when Delete is clicked', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: true })
    mockedClient.uninstallDemo.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true)
    await flushPromises()

    const deleteBtn = wrapper.find('[data-testid="demo-delete-button"]')
    expect(deleteBtn.exists()).toBe(true)
    await deleteBtn.findComponent(NButton).trigger('click')
    await flushPromises()

    expect(mockedClient.uninstallDemo).toHaveBeenCalledOnce()
    expect(wrapper.emitted('demo-changed')).toHaveLength(1)

    // Status should update to not installed
    const status = wrapper.find('[data-testid="demo-status"]')
    expect(status.text()).toContain('Not installed')
  })

  it('calls installDemo and emits demo-changed when Restore is clicked', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    mockedClient.installDemo.mockResolvedValue({ installed: true })
    const wrapper = mountDialog(true)
    await flushPromises()

    const restoreBtn = wrapper.find('[data-testid="demo-restore-button"]')
    expect(restoreBtn.exists()).toBe(true)
    await restoreBtn.findComponent(NButton).trigger('click')
    await flushPromises()

    expect(mockedClient.installDemo).toHaveBeenCalledOnce()
    expect(wrapper.emitted('demo-changed')).toHaveLength(1)

    // Status should update to installed
    const status = wrapper.find('[data-testid="demo-status"]')
    expect(status.text()).toContain('Installed')
  })

  it('shows error alert when status check fails', async () => {
    mockedClient.getDemoStatus.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Connection failed' })
    const wrapper = mountDialog(true)
    await flushPromises()

    const alert = wrapper.findComponent(NAlert)
    expect(alert.exists()).toBe(true)
  })

  it('shows error when install fails', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true)
    await flushPromises()

    mockedClient.installDemo.mockRejectedValue({ code: 'INTERNAL_ERROR', message: 'Disk full' })
    const restoreBtn = wrapper.find('[data-testid="demo-restore-button"]')
    await restoreBtn.findComponent(NButton).trigger('click')
    await flushPromises()

    const alert = wrapper.findComponent(NAlert)
    expect(alert.exists()).toBe(true)
  })

  it('fetches demo status when show changes from false to true', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: true })
    const wrapper = mount(SettingsDialog, {
      props: { show: false, isDark: false, debugMode: false },
      global: { stubs: { Teleport: true } },
    })

    expect(mockedClient.getDemoStatus).not.toHaveBeenCalled()

    await wrapper.setProps({ show: true })
    await flushPromises()

    expect(mockedClient.getDemoStatus).toHaveBeenCalledOnce()
  })

  it('does not render dialog when show is false', () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: true })
    const wrapper = mount(SettingsDialog, {
      props: { show: false, isDark: false, debugMode: false },
      global: { stubs: { Teleport: true } },
    })

    // NModal should still exist but with show=false
    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('show')).toBe(false)
  })

  // AC1: Light/Dark theme selector is in the Settings dialog
  it('renders the appearance section with theme toggle', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false)
    await flushPromises()

    const section = wrapper.find('[data-testid="appearance-section"]')
    expect(section.exists()).toBe(true)

    const themeToggle = wrapper.find('[data-testid="theme-toggle"]')
    expect(themeToggle.exists()).toBe(true)
  })

  // AC1: Theme toggle shows 'Dark' when in light mode (to switch to dark)
  it('theme toggle shows "Dark" when in light mode', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false)
    await flushPromises()

    const themeToggle = wrapper.find('[data-testid="theme-toggle"]')
    expect(themeToggle.text()).toBe('Dark')
  })

  // AC1: Theme toggle shows 'Light' when in dark mode (to switch to light)
  it('theme toggle shows "Light" when in dark mode', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, true)
    await flushPromises()

    const themeToggle = wrapper.find('[data-testid="theme-toggle"]')
    expect(themeToggle.text()).toBe('Light')
  })

  // AC3: Theme changes take effect immediately from within the dialog
  it('emits toggle-theme when the theme button is clicked', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false)
    await flushPromises()

    const themeToggle = wrapper.find('[data-testid="theme-toggle"]')
    await themeToggle.findComponent(NButton).trigger('click')

    expect(wrapper.emitted('toggle-theme')).toHaveLength(1)
  })

  // AC2: Debug mode toggle is in the Settings dialog
  it('renders the debug mode switch in the appearance section', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false, false)
    await flushPromises()

    const debugSwitch = wrapper.find('[data-testid="debug-toggle"]')
    expect(debugSwitch.exists()).toBe(true)
    expect(wrapper.findComponent(NSwitch).exists()).toBe(true)
  })

  // AC2: Debug switch reflects current debugMode prop
  it('debug switch reflects debugMode=false prop', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false, false)
    await flushPromises()

    const switchComp = wrapper.findComponent(NSwitch)
    expect(switchComp.props('value')).toBe(false)
  })

  it('debug switch reflects debugMode=true prop', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false, true)
    await flushPromises()

    const switchComp = wrapper.findComponent(NSwitch)
    expect(switchComp.props('value')).toBe(true)
  })

  // AC3: Debug mode changes take effect immediately from within the dialog
  it('emits update:debugMode when the debug switch is toggled', async () => {
    mockedClient.getDemoStatus.mockResolvedValue({ installed: false })
    const wrapper = mountDialog(true, false, false)
    await flushPromises()

    const switchComp = wrapper.findComponent(NSwitch)
    await switchComp.vm.$emit('update:value', true)

    const emitted = wrapper.emitted('update:debugMode')
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual([true])
  })
})
