import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

describe('CheckpointMetadataPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the panel with complementary role', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    expect(wrapper.find('[role="complementary"]').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toBe('Checkpoint Metadata')
  })

  it('lists checkpoints sorted by step number descending', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    const items = wrapper.findAll('[role="option"]')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toContain('step00003000')
    expect(items[1].text()).toContain('step00002000')
    expect(items[2].text()).toContain('step00001000')
  })

  it('selects the highest step count checkpoint by default', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
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
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    // Keys should be sorted
    expect(rows[0].text()).toContain('ss_epoch')
    expect(rows[0].text()).toContain('104')
    expect(rows[1].text()).toContain('ss_output_name')
    expect(rows[1].text()).toContain('test-model')
    expect(rows[2].text()).toContain('ss_total_steps')
    expect(rows[2].text()).toContain('9000')
  })

  it('shows "No metadata available" when checkpoint has no ss_* fields', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('No metadata available')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('shows loading state while fetching metadata', async () => {
    mockGetCheckpointMetadata.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Loading metadata...')
  })

  it('shows error message when API call fails', async () => {
    mockGetCheckpointMetadata.mockRejectedValue({
      code: 'NETWORK_ERROR',
      message: 'Connection lost',
    })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    const error = wrapper.find('[role="alert"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toBe('Connection lost')
  })

  it('fetches new metadata when clicking a different checkpoint', async () => {
    mockGetCheckpointMetadata
      .mockResolvedValueOnce({ metadata: { ss_epoch: '50' } })
      .mockResolvedValueOnce({ metadata: { ss_epoch: '100' } })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
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

  it('emits close event when close button is clicked', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    await wrapper.find('[aria-label="Close metadata panel"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('has accessible close button with aria-label', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    const closeBtn = wrapper.find('[aria-label="Close metadata panel"]')
    expect(closeBtn.exists()).toBe(true)
  })

  it('has accessible listbox with aria-label', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.exists()).toBe(true)
    expect(listbox.attributes('aria-label')).toBe('Checkpoint list')
  })

  it('shows step number for each checkpoint in the list', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: sampleCheckpoints },
    })
    await flushPromises()

    const items = wrapper.findAll('[role="option"]')
    expect(items[0].text()).toContain('Step 3000')
    expect(items[1].text()).toContain('Step 2000')
    expect(items[2].text()).toContain('Step 1000')
  })

  it('handles empty checkpoints array', async () => {
    const wrapper = mount(CheckpointMetadataPanel, {
      props: { checkpoints: [] },
    })
    await flushPromises()

    expect(mockGetCheckpointMetadata).not.toHaveBeenCalled()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })
})
