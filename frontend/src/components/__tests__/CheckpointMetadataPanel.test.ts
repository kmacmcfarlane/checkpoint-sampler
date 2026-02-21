import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NDrawer, NDrawerContent, NDataTable } from 'naive-ui'
import CheckpointMetadataPanel from '../CheckpointMetadataPanel.vue'
import type { CheckpointInfo } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getCheckpointMetadata: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'

const mockGetCheckpointMetadata = apiClient.getCheckpointMetadata as ReturnType<typeof vi.fn>

const sampleCheckpoints: CheckpointInfo[] = [
  { filename: 'model-step00001000.safetensors', step_number: 1000, has_samples: true },
  { filename: 'model-step00003000.safetensors', step_number: 3000, has_samples: true },
  { filename: 'model-step00002000.safetensors', step_number: 2000, has_samples: false },
]

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(CheckpointMetadataPanel, {
    props: { checkpoints: sampleCheckpoints, ...overrides },
    global: {
      stubs: {
        // Stub Teleport so drawer content renders inline (accessible to wrapper.find)
        Teleport: true,
      },
    },
  })
}

describe('CheckpointMetadataPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a NDrawer', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.findComponent(NDrawer).exists()).toBe(true)
  })

  it('lists checkpoints sorted by step number descending', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const items = wrapper.findAll('[role="option"]')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toContain('step00003000')
    expect(items[1].text()).toContain('step00002000')
    expect(items[2].text()).toContain('step00001000')
  })

  it('selects the highest step count checkpoint by default', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const selectedItem = wrapper.find('[aria-selected="true"]')
    expect(selectedItem.exists()).toBe(true)
    expect(selectedItem.text()).toContain('step00003000')
    expect(mockGetCheckpointMetadata).toHaveBeenCalledWith('model-step00003000.safetensors')
  })

  it('fetches and displays metadata when a checkpoint is selected', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({
      metadata: {
        ss_output_name: 'test-model',
        ss_total_steps: '9000',
        ss_epoch: '104',
      },
    })
    const wrapper = mountPanel()
    await flushPromises()

    // NDataTable should be rendered with sorted metadata
    const dataTable = wrapper.findComponent(NDataTable)
    expect(dataTable.exists()).toBe(true)
    const data = dataTable.props('data') as Array<{ field: string; value: string }>
    expect(data).toHaveLength(3)
    expect(data[0].field).toBe('ss_epoch')
    expect(data[0].value).toBe('104')
    expect(data[1].field).toBe('ss_output_name')
    expect(data[1].value).toBe('test-model')
    expect(data[2].field).toBe('ss_total_steps')
    expect(data[2].value).toBe('9000')
  })

  it('shows "No metadata available" when checkpoint has no ss_* fields', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('No metadata available')
    expect(wrapper.findComponent(NDataTable).exists()).toBe(false)
  })

  it('shows loading state while fetching metadata', async () => {
    mockGetCheckpointMetadata.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('Loading metadata...')
  })

  it('shows error message when API call fails', async () => {
    mockGetCheckpointMetadata.mockRejectedValue({
      code: 'NETWORK_ERROR',
      message: 'Connection lost',
    })
    const wrapper = mountPanel()
    await flushPromises()

    const error = wrapper.find('[role="alert"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toBe('Connection lost')
  })

  it('fetches new metadata when clicking a different checkpoint', async () => {
    mockGetCheckpointMetadata
      .mockResolvedValueOnce({ metadata: { ss_epoch: '50' } })
      .mockResolvedValueOnce({ metadata: { ss_epoch: '100' } })
    const wrapper = mountPanel()
    await flushPromises()

    // Initially selected: step 3000 (highest)
    expect(mockGetCheckpointMetadata).toHaveBeenCalledTimes(1)

    // Click on step 1000 (third in list since sorted descending)
    const items = wrapper.findAll('[role="option"]')
    await items[2].trigger('click')
    await flushPromises()

    expect(mockGetCheckpointMetadata).toHaveBeenCalledTimes(2)
    expect(mockGetCheckpointMetadata).toHaveBeenCalledWith('model-step00001000.safetensors')
  })

  it('emits close event when drawer is closed', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    // Simulate drawer close via NDrawer update:show event
    const drawer = wrapper.findComponent(NDrawer)
    drawer.vm.$emit('update:show', false)

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('has accessible listbox with aria-label', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.exists()).toBe(true)
    expect(listbox.attributes('aria-label')).toBe('Checkpoint list')
  })

  it('shows step number for each checkpoint in the list', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const items = wrapper.findAll('[role="option"]')
    expect(items[0].text()).toContain('Step 3000')
    expect(items[1].text()).toContain('Step 2000')
    expect(items[2].text()).toContain('Step 1000')
  })

  it('handles empty checkpoints array', async () => {
    const wrapper = mountPanel({ checkpoints: [] })
    await flushPromises()

    expect(mockGetCheckpointMetadata).not.toHaveBeenCalled()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })
})
