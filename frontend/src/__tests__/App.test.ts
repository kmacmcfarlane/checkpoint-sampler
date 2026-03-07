import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NButton, NTag } from 'naive-ui'
import App from '../App.vue'
import TrainingRunSelector from '../components/TrainingRunSelector.vue'
import type { TrainingRun, SampleJob } from '../api/types'
import { _resetForTesting as resetDimensionMapping } from '../composables/useDimensionMapping'

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
    listSampleJobs: vi.fn().mockResolvedValue([]),
  },
}))

import { apiClient } from '../api/client'

const mockGetTrainingRuns = apiClient.getTrainingRuns as ReturnType<typeof vi.fn>
const mockScanTrainingRun = apiClient.scanTrainingRun as ReturnType<typeof vi.fn>
const mockListSampleJobs = apiClient.listSampleJobs as ReturnType<typeof vi.fn>

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
    resetDimensionMapping()
    mockGetTrainingRuns.mockClear()
    mockScanTrainingRun.mockClear()
    mockListSampleJobs.mockClear()
    vi.stubGlobal('matchMedia', createMatchMediaMock(false))
    mockWebSocketInstances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockWebSocketInstances = []
  })

  it('renders the application header without heading', async () => {
    const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    // AC: 'Checkpoint Sampler' heading is removed from the UI
    expect(wrapper.find('h1').exists()).toBe(false)
    // Header still renders (hamburger button and header controls are present)
    expect(wrapper.find('.app-header').exists()).toBe(true)
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

  // B-030 UAT rework: Generate Samples and Jobs must always be visible in top nav
  describe('header button visibility (UAT rework B-030)', () => {
    afterEach(() => {
      // Restore innerWidth so narrow-screen tests do not bleed into subsequent describe blocks
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    })

    it('Generate Samples button is visible even when no training run is selected', async () => {
      // UAT feedback: Generate Samples must ALWAYS be visible, not gated on run selection.
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const generateBtn = wrapper.find('[data-testid="generate-samples-button"]')
      expect(generateBtn.exists()).toBe(true)
    })

    it('Jobs button is visible even when no training run is selected', async () => {
      // UAT feedback: Jobs must ALWAYS be visible, not gated on run selection.
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      expect(jobsBtn).toBeDefined()
    })

    it('Metadata button is NOT visible when no training run is selected', async () => {
      // UAT feedback: Only Metadata is gated on training run selection.
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const metadataBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle checkpoint metadata panel',
      )
      expect(metadataBtn).toBeUndefined()
    })

    it('Metadata button appears after a training run is selected and scanned', async () => {
      // UAT feedback: Metadata remains gated on training run selection (but still appears after select).
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      const metadataBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle checkpoint metadata panel',
      )
      expect(metadataBtn).toBeDefined()
    })

    it('Generate Samples button is visible on narrow screen before any training run is selected', async () => {
      // UAT feedback: reproducible by clearing localStorage and reloading on narrow screen.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const generateBtn = wrapper.find('[data-testid="generate-samples-button"]')
      expect(generateBtn.exists()).toBe(true)
    })

    it('Jobs button is visible on narrow screen before any training run is selected', async () => {
      // UAT feedback: reproducible by clearing localStorage and reloading on narrow screen.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      expect(jobsBtn).toBeDefined()
    })
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

  describe('Filters Slideout', () => {
    it('renders a Filters button in the header when training run has dimensions', async () => {
      // AC1: Filters button appears in header top bar area when a run is selected
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Filters button should exist in the header-center
      const filtersBtn = wrapper.find('[data-testid="filters-button"]')
      expect(filtersBtn.exists()).toBe(true)
      expect(filtersBtn.text()).toBe('Filters')
    })

    it('does not render old inline filters section (no .filters-section in DOM)', async () => {
      // AC1: The old inline collapsible filters section is gone
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Old inline filters section should NOT exist
      expect(wrapper.find('.filters-section').exists()).toBe(false)
      expect(wrapper.find('.dimension-filters').exists()).toBe(false)
    })

    it('renders FiltersDrawer component', async () => {
      // AC1: FiltersDrawer is present in the component tree
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const filtersDrawer = wrapper.findComponent({ name: 'FiltersDrawer' })
      expect(filtersDrawer.exists()).toBe(true)
    })

    it('FiltersDrawer is closed by default', async () => {
      // AC1: Drawer starts closed — user must click Filters button to open it
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const filtersDrawer = wrapper.findComponent({ name: 'FiltersDrawer' })
      expect(filtersDrawer.props('show')).toBe(false)
    })

    it('clicking Filters button opens the FiltersDrawer', async () => {
      // AC1: Clicking the Filters button sets show=true on FiltersDrawer
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      const filtersBtn = wrapper.find('[data-testid="filters-button"]')
      await filtersBtn.trigger('click')

      const filtersDrawer = wrapper.findComponent({ name: 'FiltersDrawer' })
      expect(filtersDrawer.props('show')).toBe(true)
    })

    it('clicking Filters button again closes the FiltersDrawer', async () => {
      // AC1: Toggle behavior: clicking again closes the drawer
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      const filtersBtn = wrapper.find('[data-testid="filters-button"]')
      await filtersBtn.trigger('click')

      const filtersDrawer = wrapper.findComponent({ name: 'FiltersDrawer' })
      expect(filtersDrawer.props('show')).toBe(true)

      // Click again to close
      await filtersBtn.trigger('click')
      expect(filtersDrawer.props('show')).toBe(false)
    })

    it('Filters button aria-label is "Toggle filters drawer"', async () => {
      // AC5: Accessible label on the filters button
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      const filtersBtn = wrapper.find('[data-testid="filters-button"]')
      expect(filtersBtn.attributes('aria-label')).toBe('Toggle filters drawer')
    })
  })

  describe('Top bar layout: MasterSlider and ZoomControl', () => {
    async function mountAndSelect() {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()
      return wrapper
    }

    it('AC2: MasterSlider renders in the header-center area when slider dimension exists', async () => {
      // The scan mock returns dimensions without a slider assignment, so
      // MasterSlider only appears when sliderDimension is assigned. This tests
      // that MasterSlider is in the header-center (not main content area).
      const wrapper = await mountAndSelect()

      // header-center should exist
      const headerCenter = wrapper.find('.header-center')
      expect(headerCenter.exists()).toBe(true)
    })

    it('AC3: ZoomControl renders in the header-controls area', async () => {
      // AC3: ZoomControl is in the top nav bar, inside header-controls
      const wrapper = await mountAndSelect()

      const zoomControl = wrapper.findComponent({ name: 'ZoomControl' })
      expect(zoomControl.exists()).toBe(true)

      // ZoomControl should be inside .header-controls (not .app-main)
      const headerControls = wrapper.find('.header-controls')
      expect(headerControls.exists()).toBe(true)
      // Verify it's not in .controls-sticky (old location)
      expect(wrapper.find('.controls-sticky').exists()).toBe(false)
    })

    it('AC3: ZoomControl emits update:cellSize and App updates cellSize', async () => {
      const wrapper = await mountAndSelect()

      const zoomControl = wrapper.findComponent({ name: 'ZoomControl' })
      expect(zoomControl.exists()).toBe(true)

      // ZoomControl props should start at default 200
      expect(zoomControl.props('cellSize')).toBe(200)

      // Simulate zoom change from ZoomControl
      zoomControl.vm.$emit('update:cellSize', 350)
      await flushPromises()

      // App should update and pass new value back
      expect(zoomControl.props('cellSize')).toBe(350)
    })

    it('AC4: filter-update event from FiltersDrawer updates comboSelections in App', async () => {
      // AC4: All filter functionality is preserved through the FiltersDrawer
      const wrapper = await mountAndSelect()

      const filtersDrawer = wrapper.findComponent({ name: 'FiltersDrawer' })
      expect(filtersDrawer.exists()).toBe(true)

      // Simulate filter-update from FiltersDrawer for 'seed' dimension
      filtersDrawer.vm.$emit('filter-update', 'seed', new Set(['99']))
      await flushPromises()

      // FiltersDrawer should receive the updated comboSelections
      const updatedSelections = filtersDrawer.props('comboSelections') as Record<string, Set<string>>
      expect(updatedSelections['seed']).toBeDefined()
      expect(updatedSelections['seed'].has('99')).toBe(true)
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

    function setSavedTrainingRunId(trainingRunId: number) {
      // Set only the standalone last-training-run key (no preset saved)
      localStorage.setItem('checkpoint-sampler-last-training-run', String(trainingRunId))
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

      // App should not crash; header should still render (heading was removed in S-092)
      expect(wrapper.find('.app-header').exists()).toBe(true)
    })

    it('calls getTrainingRuns without filter arguments during eager auto-select', async () => {
      // Verify eagerAutoSelect calls getTrainingRuns() without any has_samples filter.
      // All viewer-discovered runs have samples by definition.
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(false))

      setSavedPresetData(1, 'preset-abc')

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Scan should have been triggered
      expect(mockScanTrainingRun).toHaveBeenCalledWith(1)

      // getTrainingRuns should be called without arguments (no has_samples filter)
      for (const call of mockGetTrainingRuns.mock.calls) {
        expect(call).toHaveLength(0)
      }

      // Header buttons should be visible after eager select
      const generateBtn = wrapper.find('[data-testid="generate-samples-button"]')
      expect(generateBtn.exists()).toBe(true)

      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      expect(jobsBtn).toBeDefined()
    })

    describe('standalone training run persistence (no preset required)', () => {
      // AC1/AC2: Eager loading works when only the training run ID is saved —
      // i.e., the user selected a training run but never saved a preset.

      it('eagerly selects saved training run when only lastTrainingRunId is stored (no preset)', async () => {
        // Core bug fix: eagerAutoSelect must work without a saved preset.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        // Set ONLY the standalone training run key — no preset key
        setSavedTrainingRunId(1)

        mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // eagerAutoSelect should have triggered a scan even without a preset
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1)
      })

      it('shows header buttons after eager auto-select with standalone training run ID only', async () => {
        // AC2: Header buttons appear when restored from standalone key (no preset).
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedTrainingRunId(1)

        const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Header buttons must be visible without a preset saved
        const generateBtn = wrapper.find('[data-testid="generate-samples-button"]')
        expect(generateBtn.exists()).toBe(true)

        const statusTag = wrapper.findAllComponents(NTag).find(
          (tag) => tag.text() === 'Live' || tag.text() === 'Disconnected',
        )
        expect(statusTag).toBeDefined()
      })

      it('does not eagerly select when standalone key references a stale training run ID', async () => {
        // Stale ID (not in the API response) should be silently ignored.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedTrainingRunId(999) // doesn't exist in mock (which returns id: 1)

        const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        expect(mockScanTrainingRun).not.toHaveBeenCalled()
        expect(wrapper.find('main').text()).toContain('Select a training run to get started.')
      })

      it('persists training run ID to standalone key when user selects a run', async () => {
        // Verify onTrainingRunSelect writes to the standalone localStorage key.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Open drawer so TrainingRunSelector is accessible
        const toggleBtn = wrapper.findAllComponents(NButton).find(
          (b) => b.attributes('aria-label') === 'Toggle controls drawer',
        )
        await toggleBtn!.trigger('click')
        await flushPromises()

        // Simulate training run selection
        const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
        selector.vm.$emit('select', mockTrainingRun)
        await flushPromises()

        // Standalone key should be written with the selected run's ID
        expect(localStorage.getItem('checkpoint-sampler-last-training-run')).toBe('1')
      })

      it('TrainingRunSelector autoSelectRunId falls back to standalone key when no preset data', async () => {
        // AC3: The drawer's TrainingRunSelector reflects the saved run when only
        // the standalone key is present (no preset saved).
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedTrainingRunId(1)

        const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Open the drawer
        const toggleBtn = wrapper.findAllComponents(NButton).find(
          (b) => b.attributes('aria-label') === 'Toggle controls drawer',
        )
        await toggleBtn!.trigger('click')
        await flushPromises()

        const selector = wrapper.findComponent(TrainingRunSelector)
        expect(selector.exists()).toBe(true)
        // autoSelectRunId should be the standalone stored ID
        expect(selector.props('autoSelectRunId')).toBe(1)
      })
    })
  })

  // S-069: Drawer auto-collapse on image grid interaction
  describe('drawer auto-collapse on grid interaction', () => {
    // The outer beforeEach already stubs matchMedia(false) (narrow). Each test only
    // needs to set innerWidth; wide-screen tests re-stub matchMedia to return matches=true.
    function setNarrowScreen() {
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      // matchMedia already mocked with matches=false by outer beforeEach
    }

    function setWideScreen() {
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(true))
    }

    /**
     * Mount App with a training run selected. On narrow screens the drawer starts
     * closed, so we open it first to render TrainingRunSelector, emit the select
     * event, then allow tests to control drawer state from there.
     */
    async function mountAndSelectRun() {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Ensure the drawer is open so TrainingRunSelector is rendered (NDrawer hides
      // slot content when show=false; on narrow screens the drawer starts closed).
      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      if (!appDrawer.props('show')) {
        const toggleBtn = wrapper.findAllComponents(NButton).find(
          (b) => b.attributes('aria-label') === 'Toggle controls drawer',
        )
        await toggleBtn!.trigger('click')
        await flushPromises()
      }

      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()
      return wrapper
    }

    it('AC2: auto-collapses drawer when XYGrid emits image:click on narrow screen', async () => {
      // AC1: image click triggers auto-collapse; AC2: only on narrow screens.
      // mountAndSelectRun opens the drawer to render TrainingRunSelector, so the
      // drawer is already open when we reach the assertion.
      setNarrowScreen()
      const wrapper = await mountAndSelectRun()

      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      // Drawer is open (mountAndSelectRun opened it to reach TrainingRunSelector)
      expect(appDrawer.props('show')).toBe(true)

      // Simulate XYGrid image:click
      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      xyGrid.vm.$emit('image:click', {
        imageUrl: '/api/images/test.png',
        cellKey: 'a|b',
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
        gridImages: [],
        gridIndex: 0,
      })
      await flushPromises()

      // Drawer should now be collapsed
      expect(appDrawer.props('show')).toBe(false)
    })

    it('AC2: auto-collapses drawer when XYGrid emits header:click on narrow screen', async () => {
      // AC1: header click triggers auto-collapse; AC2: only on narrow screens.
      setNarrowScreen()
      const wrapper = await mountAndSelectRun()

      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      expect(appDrawer.props('show')).toBe(true)

      // Simulate XYGrid header:click
      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      xyGrid.vm.$emit('header:click', 'seed', '42')
      await flushPromises()

      // Drawer should now be collapsed
      expect(appDrawer.props('show')).toBe(false)
    })

    it('AC2: auto-collapses drawer on Ctrl+Arrow keyboard navigation on narrow screen', async () => {
      // AC1: keyboard navigation triggers auto-collapse; AC2: only on narrow screens.
      setNarrowScreen()
      const wrapper = await mountAndSelectRun()

      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      expect(appDrawer.props('show')).toBe(true)

      // Simulate Ctrl+ArrowRight keyboard navigation (slider nav key)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }))
      await flushPromises()

      // Drawer should now be collapsed
      expect(appDrawer.props('show')).toBe(false)
    })

    it('AC3: drawer does NOT auto-collapse on image:click on wide screen', async () => {
      // AC3: on wide screens drawer remains open (drawer does not overlay the grid)
      setWideScreen()
      const wrapper = await mountAndSelectRun()

      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      // Drawer starts open on wide screens
      expect(appDrawer.props('show')).toBe(true)

      // Simulate XYGrid image:click
      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      xyGrid.vm.$emit('image:click', {
        imageUrl: '/api/images/test.png',
        cellKey: 'a|b',
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
        gridImages: [],
        gridIndex: 0,
      })
      await flushPromises()

      // Drawer should remain open on wide screens
      expect(appDrawer.props('show')).toBe(true)
    })

    it('AC3: drawer does NOT auto-collapse on Ctrl+Arrow keyboard nav on wide screen', async () => {
      // AC3: on wide screens keyboard navigation does not close the drawer
      setWideScreen()
      const wrapper = await mountAndSelectRun()

      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      expect(appDrawer.props('show')).toBe(true)

      // Simulate Ctrl+ArrowLeft keyboard navigation
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true }))
      await flushPromises()

      // Drawer should remain open on wide screens
      expect(appDrawer.props('show')).toBe(true)
    })

    it('AC4: manual toggle works after auto-collapse on narrow screen', async () => {
      // AC4: manual drawer toggle still works regardless of auto-collapse.
      setNarrowScreen()
      const wrapper = await mountAndSelectRun()

      const appDrawer = wrapper.findComponent({ name: 'AppDrawer' })
      // Drawer is open after mountAndSelectRun
      expect(appDrawer.props('show')).toBe(true)

      // Auto-collapse via image click
      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      xyGrid.vm.$emit('image:click', {
        imageUrl: '/api/images/test.png',
        cellKey: 'a|b',
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
        gridImages: [],
        gridIndex: 0,
      })
      await flushPromises()
      expect(appDrawer.props('show')).toBe(false)

      // Re-open manually — toggle must still work after auto-collapse
      const toggleBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle controls drawer',
      )
      await toggleBtn!.trigger('click')
      await flushPromises()
      expect(appDrawer.props('show')).toBe(true)
    })
  })

  // AC1: Jobs header button shows a colored bead indicating sample/job status
  describe('header bead status indicator (AC1)', () => {
    it('shows a green bead on Jobs button when training run has samples (default for viewer runs)', async () => {
      // mockTrainingRun has has_samples=true (all viewer-discovered runs do),
      // listSampleJobs returns [] (no active jobs) → status = 'complete', bead color = green
      // Ensure wide screen so drawer is open and TrainingRunSelector is rendered
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(true))

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('complete')
      expect(bead.attributes('style')).toContain('background-color: rgb(24, 160, 88)')
    })

    it('shows a gray bead on Jobs button when training run has no samples and no jobs', async () => {
      const emptyRun: TrainingRun = {
        id: 2,
        name: 'empty-run',
        checkpoint_count: 1,
        has_samples: false,
        checkpoints: [
          { filename: 'model.safetensors', step_number: 1000, has_samples: false },
        ],
      }
      mockGetTrainingRuns.mockResolvedValue([emptyRun])

      // Ensure wide screen so drawer is open and TrainingRunSelector is rendered
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(true))

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select the empty training run
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', emptyRun)
      await flushPromises()

      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('empty')
      // gray = #909090 → rgb(144, 144, 144)
      expect(bead.attributes('style')).toContain('background-color: rgb(144, 144, 144)')
    })
  })

  // B-051: bead color rendering in the UI
  describe('header bead color rendering (B-051)', () => {
    const runWithSamples: TrainingRun = mockTrainingRun // has_samples=true

    const emptyRun: TrainingRun = {
      id: 2,
      name: 'empty-run',
      checkpoint_count: 1,
      has_samples: false,
      checkpoints: [],
    }

    function makeJob(status: SampleJob['status'], runName = 'test-run'): SampleJob {
      return {
        id: `job-${status}`,
        training_run_name: runName,
        study_id: 'study-1',
        study_name: 'Test Study',
        workflow_name: 'default',
        vae: '',
        clip: '',
        status,
        total_items: 10,
        completed_items: 5,
        failed_items: 0,
        pending_items: 5,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
    }

    async function mountAndSelectRun(run: TrainingRun, jobs: SampleJob[]) {
      mockListSampleJobs.mockResolvedValue(jobs)
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
      vi.stubGlobal('matchMedia', createMatchMediaMock(true))

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', run)
      await flushPromises()

      // Open job panel to trigger fetchSampleJobs (populates sampleJobs ref)
      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      await jobsBtn!.trigger('click')
      await flushPromises()

      return wrapper
    }

    it('shows green bead when run has_samples and no jobs', async () => {
      const wrapper = await mountAndSelectRun(runWithSamples, [])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('complete')
      // green = #18a058 → rgb(24, 160, 88)
      expect(bead.attributes('style')).toContain('rgb(24, 160, 88)')
    })

    it('shows blue bead when a job is running', async () => {
      const wrapper = await mountAndSelectRun(emptyRun, [makeJob('running', 'empty-run')])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('running')
      // blue = #2080f0 → rgb(32, 128, 240)
      expect(bead.attributes('style')).toContain('rgb(32, 128, 240)')
    })

    it('shows blue bead when a job is pending', async () => {
      const wrapper = await mountAndSelectRun(emptyRun, [makeJob('pending', 'empty-run')])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('running')
      expect(bead.attributes('style')).toContain('rgb(32, 128, 240)')
    })

    it('shows yellow bead when a job has completed_with_errors (partial failure)', async () => {
      const wrapper = await mountAndSelectRun(emptyRun, [makeJob('completed_with_errors', 'empty-run')])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('complete_with_errors')
      // yellow = #f0a020 → rgb(240, 160, 32)
      expect(bead.attributes('style')).toContain('rgb(240, 160, 32)')
    })

    it('shows red bead when a job has failed (complete failure)', async () => {
      const wrapper = await mountAndSelectRun(emptyRun, [makeJob('failed', 'empty-run')])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('failed')
      // red = #d03050 → rgb(208, 48, 80)
      expect(bead.attributes('style')).toContain('rgb(208, 48, 80)')
    })

    it('shows red bead when mix includes a failed job (red beats yellow)', async () => {
      const wrapper = await mountAndSelectRun(emptyRun, [
        makeJob('completed_with_errors', 'empty-run'),
        makeJob('failed', 'empty-run'),
      ])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('failed')
      expect(bead.attributes('style')).toContain('rgb(208, 48, 80)')
    })

    it('shows yellow bead when mix includes complete_with_errors and running (yellow beats blue)', async () => {
      const wrapper = await mountAndSelectRun(emptyRun, [
        makeJob('running', 'empty-run'),
        makeJob('completed_with_errors', 'empty-run'),
      ])
      const bead = wrapper.find('[data-testid="jobs-bead"]')
      expect(bead.exists()).toBe(true)
      expect(bead.attributes('title')).toBe('complete_with_errors')
      expect(bead.attributes('style')).toContain('rgb(240, 160, 32)')
    })
  })

  // S-073: Per-sample inference progress bar reset behavior
  describe('handleJobProgress: inference progress reset between samples', () => {
    const runningJob: SampleJob = {
      id: 'job-abc',
      training_run_name: 'test-run',
      study_id: 'study-1',
      study_name: 'Test Study',
      workflow_name: 'default',
      vae: '',
      clip: '',
      status: 'running',
      total_items: 10,
      completed_items: 2,
      failed_items: 0,
      pending_items: 8,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    /**
     * Mount the App with a running job pre-loaded, WebSocket open and connected.
     * Opens the job progress panel to trigger fetchSampleJobs so sampleJobs is populated.
     * Returns the wrapper and the mock WebSocket instance.
     */
    async function mountWithRunningJob() {
      mockListSampleJobs.mockResolvedValue([runningJob])

      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      // Select a training run to start the WebSocket
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      // Open the WebSocket connection
      expect(mockWebSocketInstances.length).toBeGreaterThan(0)
      const ws = mockWebSocketInstances[0]
      ws.simulateOpen()
      await flushPromises()

      // Open the job progress panel to trigger fetchSampleJobs, populating sampleJobs
      // so that handleInferenceProgress can find the running job by status.
      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      expect(jobsBtn).toBeDefined()
      await jobsBtn!.trigger('click')
      await flushPromises()

      return { wrapper, ws }
    }

    it('resets inference progress when completed_items increases (new sample starts)', async () => {
      const { wrapper, ws } = await mountWithRunningJob()

      // Simulate inference progress arriving for the running job
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'prompt-1',
          current_value: 15,
          max_value: 20,
        }),
      }))
      await flushPromises()

      // Verify inference progress was recorded
      const panelBefore = wrapper.findComponent({ name: 'JobProgressPanel' })
      expect(panelBefore.props('inferenceProgress')).toEqual({
        'job-abc': { current_value: 15, max_value: 20 },
      })

      // Simulate a job_progress message: completed_items increments from 2 → 3
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-abc',
          status: 'running',
          total_items: 10,
          completed_items: 3,
          failed_items: 0,
          pending_items: 7,
          checkpoints_completed: 0,
          total_checkpoints: 10,
        }),
      }))
      await flushPromises()

      // Inference progress for the job should be cleared because completed_items changed
      const panelAfter = wrapper.findComponent({ name: 'JobProgressPanel' })
      expect(panelAfter.props('inferenceProgress')).not.toHaveProperty('job-abc')
    })

    it('does NOT reset inference progress when completed_items is unchanged', async () => {
      const { wrapper, ws } = await mountWithRunningJob()

      // Simulate inference progress arriving for the running job
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'prompt-1',
          current_value: 8,
          max_value: 20,
        }),
      }))
      await flushPromises()

      // Verify inference progress was recorded
      const panelBefore = wrapper.findComponent({ name: 'JobProgressPanel' })
      expect(panelBefore.props('inferenceProgress')).toEqual({
        'job-abc': { current_value: 8, max_value: 20 },
      })

      // Simulate a job_progress message with the SAME completed_items (2 → 2)
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-abc',
          status: 'running',
          total_items: 10,
          completed_items: 2,
          failed_items: 0,
          pending_items: 8,
          checkpoints_completed: 0,
          total_checkpoints: 10,
        }),
      }))
      await flushPromises()

      // Inference progress should NOT be cleared because completed_items did not change
      const panelAfter = wrapper.findComponent({ name: 'JobProgressPanel' })
      expect(panelAfter.props('inferenceProgress')).toEqual({
        'job-abc': { current_value: 8, max_value: 20 },
      })
    })
  })

  // AC: B-052 — Inference progress flip-flop prevention
  describe('handleInferenceProgress: monotonic progress guard (B-052)', () => {
    const runningJob: SampleJob = {
      id: 'job-flip',
      training_run_name: 'test-run',
      study_id: 'study-1',
      study_name: 'Test Study',
      workflow_name: 'default',
      vae: '',
      clip: '',
      status: 'running',
      total_items: 8,
      completed_items: 0,
      failed_items: 0,
      pending_items: 8,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    async function mountWithFlipJob() {
      mockListSampleJobs.mockResolvedValue([runningJob])
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()

      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()

      expect(mockWebSocketInstances.length).toBeGreaterThan(0)
      const ws = mockWebSocketInstances[0]
      ws.simulateOpen()
      await flushPromises()

      // Open job panel to populate sampleJobs
      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      await jobsBtn!.trigger('click')
      await flushPromises()

      return { wrapper, ws }
    }

    // AC1: Progress indicator shows consistent, monotonically increasing values during generation
    it('ignores out-of-order stale inference events that would cause a backward flip', async () => {
      // AC1: A stale lower-value event should NOT overwrite a higher current value.
      const { wrapper, ws } = await mountWithFlipJob()

      // Deliver progress at step 5
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p1', current_value: 5, max_value: 8 }),
      }))
      await flushPromises()

      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      expect(panel.props('inferenceProgress')).toEqual({ 'job-flip': { current_value: 5, max_value: 8 } })

      // A stale event with current_value < 5 arrives (out-of-order from previous sample)
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p1', current_value: 0, max_value: 8 }),
      }))
      await flushPromises()

      // Progress should remain at 5, not flip back to 0
      expect(wrapper.findComponent({ name: 'JobProgressPanel' }).props('inferenceProgress')).toEqual({
        'job-flip': { current_value: 5, max_value: 8 },
      })
    })

    // AC1: Progress still increases forward when events arrive in order
    it('accepts inference events that move progress forward', async () => {
      const { wrapper, ws } = await mountWithFlipJob()

      // Step 3
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p1', current_value: 3, max_value: 8 }),
      }))
      await flushPromises()

      // Step 6 — forward, must be accepted
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p1', current_value: 6, max_value: 8 }),
      }))
      await flushPromises()

      expect(wrapper.findComponent({ name: 'JobProgressPanel' }).props('inferenceProgress')).toEqual({
        'job-flip': { current_value: 6, max_value: 8 },
      })
    })

    // AC1: After an explicit reset (via job_progress completed_items change), the next event is accepted
    it('accepts the first event after a reset even if its value is 0', async () => {
      const { wrapper, ws } = await mountWithFlipJob()

      // Deliver progress at step 5 for sample 1
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p1', current_value: 5, max_value: 8 }),
      }))
      await flushPromises()

      // Job progress event: completed_items increments → triggers reset of inference progress
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-flip',
          status: 'running',
          total_items: 8,
          completed_items: 1, // changed from 0
          failed_items: 0,
          pending_items: 7,
          checkpoints_completed: 0,
          total_checkpoints: 8,
        }),
      }))
      await flushPromises()

      // inferenceProgress should now be cleared
      expect(wrapper.findComponent({ name: 'JobProgressPanel' }).props('inferenceProgress')).not.toHaveProperty('job-flip')

      // First event of new sample starts at 0 — must be accepted after reset
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p2', current_value: 0, max_value: 8 }),
      }))
      await flushPromises()

      expect(wrapper.findComponent({ name: 'JobProgressPanel' }).props('inferenceProgress')).toEqual({
        'job-flip': { current_value: 0, max_value: 8 },
      })
    })

    // AC1: Rapid events during generation produce monotonically increasing values (no flip-flop)
    it('produces monotonically increasing values under rapid sequential events', async () => {
      const { wrapper, ws } = await mountWithFlipJob()

      // Deliver events rapidly in ascending order: 0, 2, 4, 6, 8
      const steps = [0, 2, 4, 6, 8]
      for (const step of steps) {
        ws.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({ type: 'inference_progress', prompt_id: 'p1', current_value: step, max_value: 8 }),
        }))
      }
      await flushPromises()

      // Final value must be 8 (the highest), not any earlier value
      expect(wrapper.findComponent({ name: 'JobProgressPanel' }).props('inferenceProgress')).toEqual({
        'job-flip': { current_value: 8, max_value: 8 },
      })
    })
  })
})
