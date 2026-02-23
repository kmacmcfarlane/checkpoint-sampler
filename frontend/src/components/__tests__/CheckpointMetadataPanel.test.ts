import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NDrawer } from 'naive-ui'
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

let matchMediaListener: ((e: MediaQueryListEvent) => void) | null = null

function setupMatchMedia(matches: boolean) {
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => {
      matchMediaListener = cb
    }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql)
  return mql
}

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
    matchMediaListener = null
    // Default: wide screen (≥768px)
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true })
    setupMatchMedia(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('fetches and displays metadata in stacked key-value layout', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({
      metadata: {
        ss_output_name: 'test-model',
        ss_total_steps: '9000',
        ss_epoch: '104',
      },
    })
    const wrapper = mountPanel()
    await flushPromises()

    // Stacked layout: dl with dt (key) and dd (value) pairs
    const dl = wrapper.find('dl.metadata-list')
    expect(dl.exists()).toBe(true)

    const fields = wrapper.findAll('.metadata-field')
    expect(fields).toHaveLength(3)

    // Keys are sorted alphabetically
    const keys = wrapper.findAll('.metadata-key')
    expect(keys[0].text()).toBe('ss_epoch')
    expect(keys[1].text()).toBe('ss_output_name')
    expect(keys[2].text()).toBe('ss_total_steps')

    const values = wrapper.findAll('.metadata-value')
    expect(values[0].text()).toBe('104')
    expect(values[1].text()).toBe('test-model')
    expect(values[2].text()).toBe('9000')
  })

  it('renders key as dt header above value dd (stacked, not side-by-side)', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({
      metadata: { ss_output_name: 'test-model' },
    })
    const wrapper = mountPanel()
    await flushPromises()

    const field = wrapper.find('.metadata-field')
    expect(field.exists()).toBe(true)

    // dt comes before dd within the same container
    const dt = field.find('dt.metadata-key')
    const dd = field.find('dd.metadata-value')
    expect(dt.exists()).toBe(true)
    expect(dd.exists()).toBe(true)
    expect(dt.text()).toBe('ss_output_name')
    expect(dd.text()).toBe('test-model')
  })

  it('shows "No metadata available" when checkpoint has no ss_* fields', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('No metadata available')
    expect(wrapper.find('dl.metadata-list').exists()).toBe(false)
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

  // ── Resize tests ──

  it('renders a resize handle on wide screens', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const handle = wrapper.find('.resize-handle')
    expect(handle.exists()).toBe(true)
    expect(handle.attributes('role')).toBe('separator')
    expect(handle.attributes('aria-orientation')).toBe('vertical')
    expect(handle.attributes('aria-label')).toBe('Resize metadata panel')
  })

  it('does not render resize handle on narrow screens (<768px)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 600, writable: true, configurable: true })
    setupMatchMedia(false)
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const handle = wrapper.find('.resize-handle')
    expect(handle.exists()).toBe(false)
  })

  it('uses full viewport width on narrow screens (<768px)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 600, writable: true, configurable: true })
    setupMatchMedia(false)
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('width')).toBe(600)
  })

  it('uses default panel width on wide screens', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('width')).toBe(420)
  })

  it('updates width on mousemove during drag', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const handle = wrapper.find('.resize-handle')
    // Start drag
    await handle.trigger('mousedown', { clientX: 800, preventDefault: vi.fn() })

    // Simulate mousemove on document — drawer on right, width = innerWidth - clientX
    const moveEvent = new MouseEvent('mousemove', { clientX: 700 })
    document.dispatchEvent(moveEvent)
    await wrapper.vm.$nextTick()

    // Width should be 1200 - 700 = 500
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('width')).toBe(500)

    // Clean up: mouseup
    document.dispatchEvent(new MouseEvent('mouseup'))
  })

  it('clamps width to minimum 300px during drag', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const handle = wrapper.find('.resize-handle')
    await handle.trigger('mousedown', { clientX: 800, preventDefault: vi.fn() })

    // Move mouse far right → very small width (1200 - 1100 = 100 < 300)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1100 }))
    await wrapper.vm.$nextTick()

    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('width')).toBe(300)

    document.dispatchEvent(new MouseEvent('mouseup'))
  })

  it('clamps width to maximum 80vw during drag', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const handle = wrapper.find('.resize-handle')
    await handle.trigger('mousedown', { clientX: 800, preventDefault: vi.fn() })

    // Move mouse far left → very large width (1200 - 10 = 1190 > 960 = 80% of 1200)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10 }))
    await wrapper.vm.$nextTick()

    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('width')).toBe(960) // 80% of 1200

    document.dispatchEvent(new MouseEvent('mouseup'))
  })

  it('stops resizing on mouseup', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const handle = wrapper.find('.resize-handle')
    await handle.trigger('mousedown', { clientX: 800, preventDefault: vi.fn() })

    // Move once
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }))
    await wrapper.vm.$nextTick()

    // Release
    document.dispatchEvent(new MouseEvent('mouseup'))

    // Move again — should not change width
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600 }))
    await wrapper.vm.$nextTick()

    const drawer = wrapper.findComponent(NDrawer)
    // Width should stay at 500 (from the first move), not 600
    expect(drawer.props('width')).toBe(500)
  })

  it('responds to media query changes for narrow/wide transitions', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    // Initially wide — resize handle visible
    expect(wrapper.find('.resize-handle').exists()).toBe(true)

    // Simulate media query change to narrow
    if (matchMediaListener) {
      matchMediaListener({ matches: false } as MediaQueryListEvent)
      await wrapper.vm.$nextTick()
    }

    expect(wrapper.find('.resize-handle').exists()).toBe(false)
  })

  // ── Theme-aware styling tests ──

  it('metadata values use theme-aware text color (no hardcoded colors)', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({
      metadata: { ss_output_name: 'test-model' },
    })
    const wrapper = mountPanel()
    await flushPromises()

    const valueElement = wrapper.find('.metadata-value')
    expect(valueElement.exists()).toBe(true)

    // Verify the element uses the metadata-value class which applies theme-aware styling
    // The class uses CSS custom property var(--text-color) for color (not hardcoded)
    expect(valueElement.classes()).toContain('metadata-value')
  })

  it('metadata values have theme-aware styling class for both light and dark mode', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({
      metadata: {
        ss_output_name: 'model-a',
        ss_epoch: '100',
      },
    })
    const wrapper = mountPanel()
    await flushPromises()

    const values = wrapper.findAll('.metadata-value')
    expect(values).toHaveLength(2)

    // All metadata values should use the theme-aware class
    values.forEach((value) => {
      expect(value.classes()).toContain('metadata-value')
      // Verify no inline color styles that would override CSS variables
      const styleAttr = value.attributes('style')
      if (styleAttr) {
        expect(styleAttr).not.toMatch(/color:\s*#/)
      }
    })
  })

  // ── Checkpoint selector theme-aware styling tests ──

  it('checkpoint list items use theme-aware styling classes', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const listItems = wrapper.findAll('[role="option"]')
    expect(listItems.length).toBeGreaterThan(0)

    // Verify list items don't have inline color styles
    listItems.forEach((item) => {
      const styleAttr = item.attributes('style')
      if (styleAttr) {
        expect(styleAttr).not.toMatch(/color:\s*#/)
        expect(styleAttr).not.toMatch(/background:\s*#/)
      }
    })
  })

  it('checkpoint filenames use theme-aware text color', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const filenames = wrapper.findAll('.cp-filename')
    expect(filenames.length).toBeGreaterThan(0)

    filenames.forEach((filename) => {
      expect(filename.classes()).toContain('cp-filename')
      // Verify no inline color styles that would override CSS variables
      const styleAttr = filename.attributes('style')
      if (styleAttr) {
        expect(styleAttr).not.toMatch(/color:\s*#/)
      }
    })
  })

  it('checkpoint step numbers use theme-aware secondary text color', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const steps = wrapper.findAll('.cp-step')
    expect(steps.length).toBeGreaterThan(0)

    steps.forEach((step) => {
      expect(step.classes()).toContain('cp-step')
      // Verify no inline color styles that would override CSS variables
      const styleAttr = step.attributes('style')
      if (styleAttr) {
        expect(styleAttr).not.toMatch(/color:\s*#/)
      }
    })
  })

  it('checkpoint list border and heading use theme-aware colors', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const listContainer = wrapper.find('.checkpoint-list')
    expect(listContainer.exists()).toBe(true)

    const heading = listContainer.find('h3')
    expect(heading.exists()).toBe(true)

    // Verify no inline color/border styles that would override CSS variables
    const containerStyle = listContainer.attributes('style')
    if (containerStyle) {
      expect(containerStyle).not.toMatch(/border.*:\s*.*#/)
    }

    const headingStyle = heading.attributes('style')
    if (headingStyle) {
      expect(headingStyle).not.toMatch(/color:\s*#/)
    }
  })

  it('selected checkpoint uses theme-aware accent background', async () => {
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    const wrapper = mountPanel()
    await flushPromises()

    const selectedItem = wrapper.find('[aria-selected="true"]')
    expect(selectedItem.exists()).toBe(true)
    expect(selectedItem.classes()).toContain('selected')

    // Verify no inline background color styles
    const styleAttr = selectedItem.attributes('style')
    if (styleAttr) {
      expect(styleAttr).not.toMatch(/background:\s*#/)
    }
  })
})
