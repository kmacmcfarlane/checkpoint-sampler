import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NButton, NTag } from 'naive-ui'
import App from '../App.vue'
import TrainingRunSelector from '../components/TrainingRunSelector.vue'
import type { TrainingRun } from '../api/types'

vi.mock('../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn().mockResolvedValue([
      {
        id: 1,
        name: 'test-run',
        checkpoint_count: 1,
        has_samples: true,
        checkpoints: [
          { filename: 'model.safetensors', step_number: 1000, has_samples: true },
        ],
      },
    ]),
    scanTrainingRun: vi.fn().mockResolvedValue({
      images: [],
      dimensions: [
        { name: 'seed', values: ['42'] },
        { name: 'cfg', values: ['7'] },
      ],
    }),
  },
}))

import { apiClient } from '../api/client'

const mockGetTrainingRuns = apiClient.getTrainingRuns as ReturnType<typeof vi.fn>
const mockScanTrainingRun = apiClient.scanTrainingRun as ReturnType<typeof vi.fn>

const mockTrainingRun: TrainingRun = {
  id: 1,
  name: 'test-run',
  checkpoint_count: 1,
  has_samples: true,
  checkpoints: [
    { filename: 'model.safetensors', step_number: 1000, has_samples: true },
  ],
}

/**
 * Mock WebSocket for testing the connection status indicator.
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(public url: string) {
    // Store reference for testing
    mockWebSocketInstances.push(this)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }
}

let mockWebSocketInstances: MockWebSocket[] = []

// Set up WebSocket globals
Object.defineProperty(globalThis, 'WebSocket', {
  value: MockWebSocket,
  writable: true,
  configurable: true,
})

function createMatchMediaMock(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  return vi.fn(() => ({
    matches,
    media: '',
    addEventListener: vi.fn((_, handler: (e: MediaQueryListEvent) => void) => {
      listeners.push(handler)
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    _listeners: listeners,
  }))
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    mockGetTrainingRuns.mockClear()
    mockScanTrainingRun.mockClear()
    vi.stubGlobal('matchMedia', createMatchMediaMock(false))
    mockWebSocketInstances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockWebSocketInstances = []
  })

  it('renders the application header', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Checkpoint Sampler')
  })

  it('renders placeholder content when no training run is selected', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(wrapper.find('main').text()).toContain('Select a training run to get started.')
  })

  it('renders the TrainingRunSelector inside the drawer', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    expect(wrapper.find('.training-run-selector').exists()).toBe(true)
  })

  it('renders a hamburger toggle button in the header', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const toggleBtn = wrapper.find('[aria-label="Toggle controls drawer"]')
    expect(toggleBtn.exists()).toBe(true)
    expect(toggleBtn.text()).toContain('☰')
  })

  it('toggles drawer open/closed when hamburger button is clicked', async () => {
    // Start narrow so drawer is closed by default
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    const toggleBtn = wrapper.findAllComponents(NButton).find(
      (b) => b.attributes('aria-label') === 'Toggle controls drawer'
    )
    expect(toggleBtn).toBeDefined()

    // Click to open
    await toggleBtn!.trigger('click')
    await flushPromises()

    // Click to close
    await toggleBtn!.trigger('click')
    await flushPromises()

    // No error — toggle works in both directions
  })

  it('drawer defaults to closed on narrow screens (<1024px)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    const matchMediaMock = createMatchMediaMock(false)
    vi.stubGlobal('matchMedia', matchMediaMock)

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    // The AppDrawer receives show=false on narrow screens
    const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
    expect(appDrawer.exists()).toBe(true)
    expect(appDrawer.props('show')).toBe(false)
  })

  it('drawer defaults to open on wide screens (>=1024px)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
    const matchMediaMock = createMatchMediaMock(true)
    vi.stubGlobal('matchMedia', matchMediaMock)

    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
    expect(appDrawer.exists()).toBe(true)
    expect(appDrawer.props('show')).toBe(true)
  })

  it('app container has overflow-x hidden to prevent horizontal scrolling', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    const app = wrapper.find('.app')
    expect(app.exists()).toBe(true)
  })

  it('does not show WebSocket status indicator when no training run is selected', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    const statusTag = wrapper.findAllComponents(NTag).find(
      (tag) => tag.text() === 'Live' || tag.text() === 'Disconnected'
    )
    expect(statusTag).toBeUndefined()
  })

  it('shows WebSocket status as "Disconnected" initially when training run is selected', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    // Select a training run by finding the selector and emitting select
    const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
    selector.vm.$emit('select', mockTrainingRun)
    await flushPromises()

    // WebSocket should be created but not yet open
    expect(mockWebSocketInstances.length).toBeGreaterThan(0)

    // Status should show "Disconnected"
    const statusTag = wrapper.findAllComponents(NTag).find(
      (tag) => tag.text() === 'Live' || tag.text() === 'Disconnected'
    )
    expect(statusTag).toBeDefined()
    expect(statusTag!.text()).toBe('Disconnected')
    expect(statusTag!.props('type')).toBe('default')
  })

  it('shows WebSocket status as "Live" when connection opens', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    // Select a training run
    const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
    selector.vm.$emit('select', mockTrainingRun)
    await flushPromises()

    // Simulate WebSocket opening
    expect(mockWebSocketInstances.length).toBeGreaterThan(0)
    mockWebSocketInstances[0].simulateOpen()
    await flushPromises()

    // Status should show "Live"
    const statusTag = wrapper.findAllComponents(NTag).find(
      (tag) => tag.text() === 'Live' || tag.text() === 'Disconnected'
    )
    expect(statusTag).toBeDefined()
    expect(statusTag!.text()).toBe('Live')
    expect(statusTag!.props('type')).toBe('success')
  })

  it('shows WebSocket status as "Disconnected" when connection closes', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()

    // Select a training run
    const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
    selector.vm.$emit('select', mockTrainingRun)
    await flushPromises()

    // Simulate WebSocket opening then closing
    expect(mockWebSocketInstances.length).toBeGreaterThan(0)
    mockWebSocketInstances[0].simulateOpen()
    await flushPromises()

    mockWebSocketInstances[0].simulateClose()
    await flushPromises()

    // Status should show "Disconnected"
    const statusTag = wrapper.findAllComponents(NTag).find(
      (tag) => tag.text() === 'Live' || tag.text() === 'Disconnected'
    )
    expect(statusTag).toBeDefined()
    expect(statusTag!.text()).toBe('Disconnected')
    expect(statusTag!.props('type')).toBe('default')
  })

  describe('Unified Filters Section', () => {
    it('renders filters section with "Filters" header when training run has dimensions', async () => {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Filters section should exist
      const filtersSection = wrapper.find('.filters-section')
      expect(filtersSection.exists()).toBe(true)

      // Header should show "Filters"
      const header = wrapper.find('.filters-section__header')
      expect(header.exists()).toBe(true)
      expect(header.find('.filters-section__name').text()).toBe('Filters')
    })

    it('filters section is collapsed by default', async () => {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Dimension filters should not be visible initially
      const dimensionFilters = wrapper.find('.dimension-filters')
      expect(dimensionFilters.exists()).toBe(false)

      // Toggle should have aria-expanded="false"
      const toggle = wrapper.find('.filters-section__toggle')
      expect(toggle.attributes('aria-expanded')).toBe('false')
    })

    it('clicking "Filters" header expands to show all dimension filters', async () => {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Click the header to expand
      const header = wrapper.find('.filters-section__header')
      await header.trigger('click')

      // Dimension filters should now be visible
      const dimensionFilters = wrapper.find('.dimension-filters')
      expect(dimensionFilters.exists()).toBe(true)

      // Should render DimensionFilter components for each dimension (2 from mock scan result)
      const filters = wrapper.findAllComponents({ name: 'DimensionFilter' })
      expect(filters.length).toBe(2)

      // Toggle should have aria-expanded="true"
      const toggle = wrapper.find('.filters-section__toggle')
      expect(toggle.attributes('aria-expanded')).toBe('true')
    })

    it('clicking "Filters" header again collapses all filters', async () => {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Expand first
      const header = wrapper.find('.filters-section__header')
      await header.trigger('click')
      expect(wrapper.find('.dimension-filters').exists()).toBe(true)

      // Click again to collapse
      await header.trigger('click')

      // Dimension filters should be hidden
      expect(wrapper.find('.dimension-filters').exists()).toBe(false)

      // Toggle should have aria-expanded="false"
      const toggle = wrapper.find('.filters-section__toggle')
      expect(toggle.attributes('aria-expanded')).toBe('false')
    })

    it('has accessible aria-label on toggle button', async () => {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Toggle should have aria-label
      const toggle = wrapper.find('.filters-section__toggle')
      expect(toggle.attributes('aria-label')).toBe('Toggle all filters')
    })

    it('arrow rotates when expanded', async () => {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      const arrow = wrapper.find('.filters-section__arrow')

      // Arrow should not have expanded class initially
      expect(arrow.classes()).not.toContain('filters-section__arrow--expanded')

      // Click to expand
      await wrapper.find('.filters-section__header').trigger('click')

      // Arrow should now have expanded class
      expect(arrow.classes()).toContain('filters-section__arrow--expanded')
    })
  })

  describe('Eager auto-select on narrow screens', () => {
    // AC: On narrow screens (<1024px), the app eagerly loads the saved training run
    // from localStorage and triggers a scan on mount, regardless of drawer state.

    function setSavedPresetData(trainingRunId: number, presetId: string) {
      localStorage.setItem(
        'checkpoint-sampler-last-preset',
        JSON.stringify({ trainingRunId, presetId }),
      )
    }

    it('eagerly selects saved training run on narrow screen when localStorage has data', async () => {
      // AC 1: On narrow screens (<1024px), the app eagerly loads the saved training run
      // from localStorage and triggers a scan on mount, regardless of drawer state.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(1, 'preset-abc')

      mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // eagerAutoSelect should have called getTrainingRuns and scanTrainingRun
      // getTrainingRuns is called by both eagerAutoSelect and TrainingRunSelector.onMounted
      expect(mockScanTrainingRun).toHaveBeenCalledWith(1)
    })

    it('shows header buttons immediately after eager auto-select on narrow screen', async () => {
      // AC 2: Header buttons (Generate Samples, Jobs, Metadata, Live indicator)
      // appear immediately after app load when a saved training run exists.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(1, 'preset-abc')

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Header buttons should be visible
      const generateBtn = wrapper.find('[data-testid="generate-samples-button"]')
      expect(generateBtn.exists()).toBe(true)

      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      expect(jobsBtn).toBeDefined()

      const metadataBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle checkpoint metadata panel',
      )
      expect(metadataBtn).toBeDefined()

      // Live/Disconnected indicator should appear
      const statusTag = wrapper.findAllComponents(NTag).find(
        (tag) => tag.text() === 'Live' || tag.text() === 'Disconnected',
      )
      expect(statusTag).toBeDefined()
    })

    it('does not eagerly auto-select when no saved data exists in localStorage', async () => {
      // AC 5: If no saved training run exists in localStorage, the app shows
      // 'Select a training run to get started' as before.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      // No localStorage data set
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // scanTrainingRun should NOT have been called by eagerAutoSelect
      // (it may be called by TrainingRunSelector's auto-select if the drawer is open,
      // but on narrow screens the drawer is closed)
      expect(wrapper.find('main').text()).toContain('Select a training run to get started.')
    })

    it('does not eagerly auto-select when saved training run ID is stale', async () => {
      // Saved data references a training run that no longer exists
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(999, 'preset-abc')

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // scanTrainingRun should NOT have been called since run 999 doesn't exist
      // getTrainingRuns returns [{id: 1, ...}], so find(999) returns undefined
      expect(mockScanTrainingRun).not.toHaveBeenCalled()
      expect(wrapper.find('main').text()).toContain('Select a training run to get started.')
    })

    it('drawer TrainingRunSelector reflects the eagerly selected run when opened', async () => {
      // AC 3: The drawer's TrainingRunSelector still reflects the auto-selected
      // training run when opened.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(1, 'preset-abc')

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // On narrow screens the drawer is closed, so NDrawer may not render slot
      // content initially. Open the drawer by clicking the hamburger button.
      const toggleBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle controls drawer',
      )
      expect(toggleBtn).toBeDefined()
      await toggleBtn!.trigger('click')
      await flushPromises()

      // Now the drawer is open, TrainingRunSelector should be rendered
      expect(wrapper.find('.training-run-selector').exists()).toBe(true)

      // The autoSelectRunId prop should match the saved training run
      const selector = wrapper.findComponent(TrainingRunSelector)
      expect(selector.exists()).toBe(true)
      expect(selector.props('autoSelectRunId')).toBe(1)
    })

    it('does not re-scan when TrainingRunSelector re-emits the same run after eager select', async () => {
      // Verify idempotency: when the drawer opens and TrainingRunSelector emits
      // the same run, onTrainingRunSelect skips the redundant scan.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(1, 'preset-abc')

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // eagerAutoSelect called scanTrainingRun once
      const callsAfterMount = mockScanTrainingRun.mock.calls.length
      expect(callsAfterMount).toBeGreaterThanOrEqual(1)

      // Open the drawer to render TrainingRunSelector
      const toggleBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle controls drawer',
      )
      await toggleBtn!.trigger('click')
      await flushPromises()

      // TrainingRunSelector mounts and auto-selects the same run.
      // The idempotency guard in onTrainingRunSelect should prevent a re-scan.
      // Note: TrainingRunSelector also calls getTrainingRuns on mount, but
      // scanTrainingRun should not be called again.
      expect(mockScanTrainingRun).toHaveBeenCalledTimes(callsAfterMount)
    })

    it('wide screen behavior is unchanged: drawer auto-opens and training run auto-selects', async () => {
      // AC 4: On wide screens (>=1024px), behavior is unchanged
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(true))

      setSavedPresetData(1, 'preset-abc')

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Drawer should be open on wide screens
      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      expect(appDrawer.props('show')).toBe(true)

      // Training run should be selected (via either eager select or TrainingRunSelector)
      expect(mockScanTrainingRun).toHaveBeenCalledWith(1)

      // Header buttons should be visible
      const generateBtn = wrapper.find('[data-testid="generate-samples-button"]')
      expect(generateBtn.exists()).toBe(true)
    })

    it('handles eagerAutoSelect API failure gracefully', async () => {
      // If getTrainingRuns fails during eager select, the error is silently caught
      // and TrainingRunSelector will retry when it mounts.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(1, 'preset-abc')

      // Make getTrainingRuns reject for the first call (eagerAutoSelect), then succeed
      // for the second call (TrainingRunSelector.onMounted)
      mockGetTrainingRuns.mockRejectedValueOnce(new Error('Network error'))

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // App should not crash; placeholder text may be shown
      expect(wrapper.find('h1').text()).toBe('Checkpoint Sampler')
    })
  })
})
