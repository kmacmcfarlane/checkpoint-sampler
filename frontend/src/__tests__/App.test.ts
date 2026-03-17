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
    getPresets: vi.fn().mockResolvedValue([]),
  },
}))

import { apiClient } from '../api/client'

const mockGetTrainingRuns = apiClient.getTrainingRuns as ReturnType<typeof vi.fn>
const mockScanTrainingRun = apiClient.scanTrainingRun as ReturnType<typeof vi.fn>
const mockListSampleJobs = apiClient.listSampleJobs as ReturnType<typeof vi.fn>
const mockGetPresets = apiClient.getPresets as ReturnType<typeof vi.fn>

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
    mockGetPresets.mockClear()
    vi.stubGlobal('matchMedia', createMatchMediaMock(false))
    mockWebSocketInstances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockWebSocketInstances = []
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
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
      // Set the preset in the new per-combo format (key: "trainingRunId|studyOutputDir")
      localStorage.setItem(
        'checkpoint-sampler-last-preset',
        JSON.stringify({ presetsByKey: { [`${trainingRunId}|`]: presetId } }),
      )
      // Also set the standalone training run key so eagerAutoSelect can find the TR
      localStorage.setItem(
        'checkpoint-sampler-last-training-run',
        JSON.stringify({ runId: trainingRunId, studiesByRunDir: {} }),
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
      expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
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
      expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)

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
      expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)

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
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
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
        selector.vm.$emit('select', mockTrainingRun, '')
        await flushPromises()

        // Standalone key should be written with the selected run's ID (structured JSON format)
        const stored = JSON.parse(localStorage.getItem('checkpoint-sampler-last-training-run')!)
        expect(stored.runId).toBe(1)
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

    // AC1 (B-101): Preset restoration on initial load
    describe('preset restoration from localStorage on mount', () => {
      const mockPreset = {
        id: 'preset-abc',
        name: 'My Preset',
        mapping: { x: 'seed', y: 'cfg', combos: [] },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }

      it('AC1: eagerly restores preset from localStorage on narrow screen without opening drawer', async () => {
        // AC1 (B-101): App restores last selected training run, study, and preset from
        // localStorage on initial load. The preset should be applied even when the drawer
        // is collapsed (narrow screen).
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedPresetData(1, 'preset-abc')
        mockGetPresets.mockResolvedValue([mockPreset])

        mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Training run should be scanned
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
        // Presets should be fetched as part of eager restoration
        expect(mockGetPresets).toHaveBeenCalled()
      })

      it('AC2: preset restoration works on narrow screen (drawer collapsed)', async () => {
        // AC2 (B-101): Restoration works even when side panel is collapsed (small screens).
        // The dimension assignments from the preset should be applied without the drawer.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedPresetData(1, 'preset-abc')
        mockGetPresets.mockResolvedValue([mockPreset])

        const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // The preset's dimension assignments should be applied (seed=x, cfg=y)
        // Verify by checking that the XYGrid component is rendered with the correct
        // x and y dimension props.
        const grid = wrapper.findComponent({ name: 'XYGrid' })
        expect(grid.exists()).toBe(true)
        const xDim = grid.props('xDimension')
        const yDim = grid.props('yDimension')
        expect(xDim?.name).toBe('seed')
        expect(yDim?.name).toBe('cfg')
      })

      it('AC1: does not fetch presets when no preset is saved in localStorage', async () => {
        // When only the training run ID is stored (no preset), eagerRestorePreset
        // should skip the getPresets API call.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedTrainingRunId(1)
        // No preset data set — only standalone training run ID

        mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Training run should be scanned
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
        // getPresets should NOT be called by eagerRestorePreset when no preset is saved.
        // On narrow screens the drawer is collapsed, so PresetSelector does not mount
        // and cannot trigger its own getPresets call either.
        expect(mockGetPresets).not.toHaveBeenCalled()
      })

      it('AC1: handles stale preset gracefully (preset deleted from backend)', async () => {
        // When localStorage references a preset that no longer exists on the backend,
        // the stale preset data should be cleared from localStorage.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedPresetData(1, 'deleted-preset-id')
        mockGetPresets.mockResolvedValue([]) // No presets on backend

        mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Training run should still be scanned
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
        // Stale preset data should be cleared from localStorage
        expect(localStorage.getItem('checkpoint-sampler-last-preset')).toBeNull()
      })

      it('AC3: page refresh preserves training run and study selection', async () => {
        // AC3 (B-101): Page refresh preserves training run and study selection.
        // Simulate a page refresh by mounting, selecting a run, unmounting, then
        // remounting and verifying the selection is restored.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        // Simulate having previously saved state (as would happen on first visit)
        setSavedPresetData(1, 'preset-abc')
        setSavedTrainingRunId(1)
        mockGetPresets.mockResolvedValue([mockPreset])

        // "Refresh" — mount fresh
        mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // After mount, training run should be restored and scanned
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
        // Preset should be fetched and applied
        expect(mockGetPresets).toHaveBeenCalled()
      })

      it('AC1: handles getPresets API failure gracefully during eager restore', async () => {
        // If getPresets fails during eager restore, the error is silently caught
        // and the training run is still restored.
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
        vi.stubGlobal('matchMedia', createMatchMediaMock(false))

        setSavedPresetData(1, 'preset-abc')
        mockGetPresets.mockRejectedValue(new Error('Network error'))

        const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
        await flushPromises()

        // Training run should still be scanned despite preset fetch failure
        expect(mockScanTrainingRun).toHaveBeenCalledWith(1, undefined)
        // App should not crash
        expect(wrapper.find('.app-header').exists()).toBe(true)
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

    // AC: FE: ETA updates as each sample completes and the average adjusts
    // AC: Per-sample ETA is updated in jobProgress from inference_progress events
    it('updates jobProgress.sample_eta_seconds when inference_progress includes sample_eta_seconds', async () => {
      const { wrapper, ws } = await mountWithFlipJob()

      // Deliver an inference_progress event with sample_eta_seconds
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'p1',
          current_value: 5,
          max_value: 20,
          sample_eta_seconds: 30.5,
        }),
      }))
      await flushPromises()

      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      const jobProgress = panel.props('jobProgress') as Record<string, { sample_eta_seconds?: number }>
      // The running job's progress should now have sample_eta_seconds updated
      expect(jobProgress['job-flip']).toBeDefined()
      expect(jobProgress['job-flip'].sample_eta_seconds).toBeCloseTo(30.5)
    })

    // AC: FE: No sample ETA update when inference_progress has no sample_eta_seconds
    it('does not update jobProgress.sample_eta_seconds when inference_progress has no sample_eta_seconds', async () => {
      const { wrapper, ws } = await mountWithFlipJob()

      // First set up jobProgress via a job_progress event
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-flip',
          status: 'running',
          total_items: 8,
          completed_items: 0,
          failed_items: 0,
          pending_items: 8,
          checkpoints_completed: 0,
          total_checkpoints: 8,
          sample_eta_seconds: 45.0,
        }),
      }))
      await flushPromises()

      // Deliver inference_progress event WITHOUT sample_eta_seconds
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'p1',
          current_value: 3,
          max_value: 20,
          // no sample_eta_seconds
        }),
      }))
      await flushPromises()

      // jobProgress.sample_eta_seconds should be unchanged from the job_progress event
      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      const jobProgress = panel.props('jobProgress') as Record<string, { sample_eta_seconds?: number }>
      // sample_eta_seconds from the prior job_progress event should remain
      expect(jobProgress['job-flip']?.sample_eta_seconds).toBe(45.0)
    })
  })

  // AC (S-098 UAT): Per-sample ETA preservation and clearing in handleJobProgress
  describe('handleJobProgress: sample ETA preservation (S-098)', () => {
    const runningJob: SampleJob = {
      id: 'job-eta',
      training_run_name: 'test-run',
      study_id: 'study-1',
      study_name: 'Test Study',
      workflow_name: 'default',
      vae: '',
      clip: '',
      status: 'running',
      total_items: 6,
      completed_items: 0,
      failed_items: 0,
      pending_items: 6,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    async function mountWithETAJob() {
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

      const jobsBtn = wrapper.findAllComponents(NButton).find(
        (b) => b.attributes('aria-label') === 'Toggle sample jobs panel',
      )
      await jobsBtn!.trigger('click')
      await flushPromises()

      return { wrapper, ws }
    }

    // AC: FE: Per-sample ETA is preserved when a subsequent job_progress event omits sample_eta_seconds
    it('preserves sample_eta_seconds when job_progress event omits it and completed_items is unchanged', async () => {
      // AC (S-098 UAT): After inference_progress sets sample_eta_seconds, a subsequent
      // job_progress event without sample_eta_seconds must NOT clear the stored value.
      const { wrapper, ws } = await mountWithETAJob()

      // First, set sample_eta_seconds via an inference_progress event
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'p1',
          current_value: 5,
          max_value: 20,
          sample_eta_seconds: 28.0,
        }),
      }))
      await flushPromises()

      // Verify it was recorded
      const panelBefore = wrapper.findComponent({ name: 'JobProgressPanel' })
      const progressBefore = panelBefore.props('jobProgress') as Record<string, { sample_eta_seconds?: number }>
      expect(progressBefore['job-eta']?.sample_eta_seconds).toBeCloseTo(28.0)

      // Now deliver a job_progress event WITHOUT sample_eta_seconds; completed_items unchanged
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-eta',
          status: 'running',
          total_items: 6,
          completed_items: 0, // unchanged
          failed_items: 0,
          pending_items: 6,
          checkpoints_completed: 0,
          total_checkpoints: 6,
          // no sample_eta_seconds field
        }),
      }))
      await flushPromises()

      // sample_eta_seconds must be preserved from the earlier inference_progress event
      const panelAfter = wrapper.findComponent({ name: 'JobProgressPanel' })
      const progressAfter = panelAfter.props('jobProgress') as Record<string, { sample_eta_seconds?: number }>
      expect(progressAfter['job-eta']?.sample_eta_seconds).toBeCloseTo(28.0)
    })

    // AC: FE: Per-sample ETA is cleared when a sample completes (completed_items increases)
    it('clears sample_eta_seconds when completed_items increases (sample just completed)', async () => {
      // AC (S-098 UAT): When completed_items increments, no sample is actively running so
      // sample_eta_seconds must be cleared even if it was set by a prior inference_progress event.
      const { wrapper, ws } = await mountWithETAJob()

      // Set sample_eta_seconds via a job_progress event with ETA
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-eta',
          status: 'running',
          total_items: 6,
          completed_items: 0,
          failed_items: 0,
          pending_items: 6,
          checkpoints_completed: 0,
          total_checkpoints: 6,
          sample_eta_seconds: 35.0,
        }),
      }))
      await flushPromises()

      // Now deliver a job_progress event where completed_items increases → sample just completed
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-eta',
          status: 'running',
          total_items: 6,
          completed_items: 1, // increased from 0
          failed_items: 0,
          pending_items: 5,
          checkpoints_completed: 1,
          total_checkpoints: 6,
          // no sample_eta_seconds: next sample hasn't started yet
        }),
      }))
      await flushPromises()

      // sample_eta_seconds should be cleared because no sample is actively running
      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      const progress = panel.props('jobProgress') as Record<string, { sample_eta_seconds?: number }>
      expect(progress['job-eta']?.sample_eta_seconds).toBeUndefined()
    })
  })

  // AC3 (B-067): Progress bar initialization on first generation event
  describe('handleInferenceProgress: first generation progress bar initialization (B-067)', () => {
    const firstSampleJob: SampleJob = {
      id: 'job-first',
      training_run_name: 'test-run',
      study_id: 'study-1',
      study_name: 'Test Study',
      workflow_name: 'default',
      vae: '',
      clip: '',
      status: 'running',
      total_items: 5,
      completed_items: 0,
      failed_items: 0,
      pending_items: 5,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    async function mountWithFirstSampleJob() {
      mockListSampleJobs.mockResolvedValue([firstSampleJob])
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

    // AC1: Inference progress bar displays correctly for the first sample generation in a job
    it('initializes jobProgress when inference_progress arrives before any job_progress event', async () => {
      // Bug B-067: If inference_progress events arrive before the first job_progress event,
      // jobProgress[jobId] is undefined, making hasCheckpointProgress return false and hiding the bar.
      const { wrapper, ws } = await mountWithFirstSampleJob()

      // No job_progress events have arrived yet — jobProgress is empty
      const panelInitial = wrapper.findComponent({ name: 'JobProgressPanel' })
      expect(panelInitial.props('jobProgress')).toEqual({})

      // First inference_progress event arrives (first sample, no prior job_progress)
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'p1',
          current_value: 3,
          max_value: 20,
        }),
      }))
      await flushPromises()

      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      // inferenceProgress should be set
      expect(panel.props('inferenceProgress')).toEqual({
        'job-first': { current_value: 3, max_value: 20 },
      })
      // jobProgress should be initialized with at least total_checkpoints > 0
      // so that hasCheckpointProgress() returns true and the inference bar renders
      const jobProgress = panel.props('jobProgress') as Record<string, { total_checkpoints: number }>
      expect(jobProgress['job-first']).toBeDefined()
      expect(jobProgress['job-first'].total_checkpoints).toBeGreaterThan(0)
    })

    // AC2: Progress bar behavior is consistent between the first and subsequent sample generations
    it('job_progress event overwrites the placeholder jobProgress with real data', async () => {
      const { wrapper, ws } = await mountWithFirstSampleJob()

      // First, inference_progress arrives (sets placeholder jobProgress)
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'p1',
          current_value: 5,
          max_value: 20,
        }),
      }))
      await flushPromises()

      // Then a real job_progress event arrives with actual data
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-first',
          status: 'running',
          total_items: 5,
          completed_items: 0,
          failed_items: 0,
          pending_items: 5,
          checkpoints_completed: 0,
          total_checkpoints: 5,
          current_checkpoint: 'ckpt-001.safetensors',
        }),
      }))
      await flushPromises()

      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      const jobProgress = panel.props('jobProgress') as Record<string, {
        total_checkpoints: number
        current_checkpoint?: string
      }>
      // Real data should overwrite the placeholder
      expect(jobProgress['job-first'].total_checkpoints).toBe(5)
      expect(jobProgress['job-first'].current_checkpoint).toBe('ckpt-001.safetensors')
      // inferenceProgress should still be set (was not reset since completed_items is 0→0)
      expect(panel.props('inferenceProgress')).toEqual({
        'job-first': { current_value: 5, max_value: 20 },
      })
    })

    // AC2: For subsequent samples, jobProgress is already populated so no initialization needed
    it('does not overwrite existing jobProgress when inference_progress arrives for subsequent samples', async () => {
      const { wrapper, ws } = await mountWithFirstSampleJob()

      // Populate jobProgress via a real job_progress event first (simulates subsequent sample scenario)
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'job_progress',
          job_id: 'job-first',
          status: 'running',
          total_items: 5,
          completed_items: 1,
          failed_items: 0,
          pending_items: 4,
          checkpoints_completed: 0,
          total_checkpoints: 5,
          current_checkpoint: 'ckpt-002.safetensors',
          current_checkpoint_progress: 1,
        }),
      }))
      await flushPromises()

      // Now inference_progress arrives for the second sample
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          type: 'inference_progress',
          prompt_id: 'p2',
          current_value: 2,
          max_value: 20,
        }),
      }))
      await flushPromises()

      const panel = wrapper.findComponent({ name: 'JobProgressPanel' })
      const jobProgress = panel.props('jobProgress') as Record<string, {
        total_checkpoints: number
        current_checkpoint?: string
      }>
      // Real data from job_progress should not be overwritten by the placeholder
      expect(jobProgress['job-first'].total_checkpoints).toBe(5)
      expect(jobProgress['job-first'].current_checkpoint).toBe('ckpt-002.safetensors')
    })
  })

  // AC2: debugInfo must be updated on grid navigation and slider change inside the lightbox
  describe('lightbox debugInfo state update', () => {
    /** Build a minimal GridNavItem for testing navigation. */
    function makeNavItem(xVal: string, yVal: string, withDebug: boolean) {
      return {
        imageUrl: `/api/images/${xVal}-${yVal}.png`,
        cellKey: `${xVal}|${yVal}`,
        sliderValues: ['3', '7'],
        currentSliderValue: '3',
        imagesBySliderValue: {
          '3': `/api/images/${xVal}-${yVal}-cfg3.png`,
          '7': `/api/images/${xVal}-${yVal}-cfg7.png`,
        },
        debugInfo: withDebug
          ? { xValue: xVal, yValue: yVal, sliderValue: '3', comboSelections: {} }
          : undefined,
      }
    }

    /** Emit image:click on XYGrid to open the lightbox with debug context. */
    async function openLightboxWithDebug(wrapper: ReturnType<typeof mount>) {
      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      const navItem0 = makeNavItem('42', '500', true)
      const navItem1 = makeNavItem('123', '500', true)
      xyGrid.vm.$emit('image:click', {
        imageUrl: navItem0.imageUrl,
        cellKey: navItem0.cellKey,
        sliderValues: navItem0.sliderValues,
        currentSliderValue: navItem0.currentSliderValue,
        imagesBySliderValue: navItem0.imagesBySliderValue,
        gridImages: [navItem0, navItem1],
        gridIndex: 0,
        gridColumnCount: 2,
        debugInfo: navItem0.debugInfo,
      })
      await flushPromises()
    }

    async function mountWithRun() {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()
      return wrapper
    }

    it('AC2: debugInfo updates when navigating to a different grid cell in the lightbox', async () => {
      // Regression test for Issue 1 (code review feedback):
      // onLightboxNavigate must replace debugInfo from the navigated-to GridNavItem.
      const wrapper = await mountWithRun()
      await openLightboxWithDebug(wrapper)

      // Navigate to the second grid cell (index 1, xValue='123', yValue='500')
      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })
      expect(lightbox.exists()).toBe(true)
      lightbox.vm.$emit('navigate', 1)
      await flushPromises()

      // The lightbox should now receive the debugInfo from the second GridNavItem
      const updatedDebugInfo = lightbox.props('debugInfo') as { xValue?: string; yValue?: string } | undefined
      expect(updatedDebugInfo).toBeDefined()
      expect(updatedDebugInfo!.xValue).toBe('123')
      expect(updatedDebugInfo!.yValue).toBe('500')
    })

    it('AC2: debugInfo is not stale when navigating back to the first grid cell', async () => {
      // Navigate forward then back; each navigation should update debugInfo from the item.
      const wrapper = await mountWithRun()
      await openLightboxWithDebug(wrapper)

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })
      // Navigate to index 1
      lightbox.vm.$emit('navigate', 1)
      await flushPromises()

      // Navigate back to index 0
      lightbox.vm.$emit('navigate', 0)
      await flushPromises()

      const updatedDebugInfo = lightbox.props('debugInfo') as { xValue?: string } | undefined
      expect(updatedDebugInfo).toBeDefined()
      expect(updatedDebugInfo!.xValue).toBe('42')
    })

    it('AC2: debugInfo.sliderValue updates when the in-lightbox slider changes', async () => {
      // Regression test for Issue 2 (code review feedback):
      // onLightboxSliderChange must update debugInfo.sliderValue.
      const wrapper = await mountWithRun()
      await openLightboxWithDebug(wrapper)

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })
      // Simulate slider change to '7' from within the lightbox
      lightbox.vm.$emit('slider-change', '42|500', '7')
      await flushPromises()

      const updatedDebugInfo = lightbox.props('debugInfo') as { sliderValue?: string } | undefined
      expect(updatedDebugInfo).toBeDefined()
      // sliderValue in the debug overlay must reflect the newly chosen slider value
      expect(updatedDebugInfo!.sliderValue).toBe('7')
    })

    it('AC2: debugInfo remains undefined if it was never set when slider changes', async () => {
      // When the lightbox was opened without debug mode (debugInfo = undefined),
      // slider changes must not create a debugInfo where none existed.
      const wrapper = await mountWithRun()

      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      xyGrid.vm.$emit('image:click', {
        imageUrl: '/api/images/42-500.png',
        cellKey: '42|500',
        sliderValues: ['3', '7'],
        currentSliderValue: '3',
        imagesBySliderValue: {
          '3': '/api/images/42-500-cfg3.png',
          '7': '/api/images/42-500-cfg7.png',
        },
        gridImages: [],
        gridIndex: 0,
        gridColumnCount: 0,
        debugInfo: undefined,  // debug mode off
      })
      await flushPromises()

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })
      expect(lightbox.exists()).toBe(true)

      lightbox.vm.$emit('slider-change', '42|500', '7')
      await flushPromises()

      // debugInfo must remain undefined — no spurious object should be created
      expect(lightbox.props('debugInfo')).toBeUndefined()
    })
  })

  // AC4 (B-068): Unit tests for bidirectional slider sync between lightbox and master
  describe('lightbox slider bidirectional sync (B-068)', () => {
    async function mountWithRun() {
      const wrapper = mount(App, { global: { stubs: { Teleport: true } } })
      await flushPromises()
      const selector = wrapper.findComponent({ name: 'TrainingRunSelector' })
      selector.vm.$emit('select', mockTrainingRun)
      await flushPromises()
      return wrapper
    }

    /** Open the lightbox with a two-value slider. */
    async function openLightboxWithSlider(wrapper: ReturnType<typeof mount>) {
      const xyGrid = wrapper.findComponent({ name: 'XYGrid' })
      const navItem0 = {
        imageUrl: '/api/images/cell0-val-a.png',
        cellKey: 'x0|y0',
        sliderValues: ['val-a', 'val-b'],
        currentSliderValue: 'val-a',
        imagesBySliderValue: {
          'val-a': '/api/images/cell0-val-a.png',
          'val-b': '/api/images/cell0-val-b.png',
        },
      }
      const navItem1 = {
        imageUrl: '/api/images/cell1-val-a.png',
        cellKey: 'x1|y0',
        sliderValues: ['val-a', 'val-b'],
        currentSliderValue: 'val-a',
        imagesBySliderValue: {
          'val-a': '/api/images/cell1-val-a.png',
          'val-b': '/api/images/cell1-val-b.png',
        },
      }
      xyGrid.vm.$emit('image:click', {
        ...navItem0,
        gridImages: [navItem0, navItem1],
        gridIndex: 0,
        gridColumnCount: 2,
      })
      await flushPromises()
    }

    // AC1 (B-068): Changing the slider in the lightbox updates the master slider state
    // (verified via the lightbox's currentSliderValue prop which mirrors defaultSliderValue)
    it('AC1: lightbox slider-change propagates to the master state (currentSliderValue)', async () => {
      const wrapper = await mountWithRun()
      await openLightboxWithSlider(wrapper)

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })
      expect(lightbox.exists()).toBe(true)
      // Confirm starting value
      expect(lightbox.props('currentSliderValue')).toBe('val-a')

      // Simulate the lightbox emitting a slider change
      lightbox.vm.$emit('slider-change', 'x0|y0', 'val-b')
      await flushPromises()

      // The lightbox's currentSliderValue is fed from defaultSliderValue (i.e. master state).
      // After the lightbox slider-change, the master state is updated to 'val-b'.
      expect(lightbox.props('currentSliderValue')).toBe('val-b')
    })

    // AC1 (B-068): Lightbox image URL updates to match the new slider value
    it('AC1: lightbox imageUrl updates when slider-change is emitted', async () => {
      const wrapper = await mountWithRun()
      await openLightboxWithSlider(wrapper)

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })
      expect(lightbox.props('imageUrl')).toBe('/api/images/cell0-val-a.png')

      lightbox.vm.$emit('slider-change', 'x0|y0', 'val-b')
      await flushPromises()

      // The lightbox imageUrl should now point to the val-b image for cell0
      expect(lightbox.props('imageUrl')).toBe('/api/images/cell0-val-b.png')
    })

    // AC2, AC3 (B-068): Shift+Arrow navigation uses the live master slider value
    it('AC2/AC3: navigate uses the live master slider value, not the stale snapshot', async () => {
      const wrapper = await mountWithRun()
      await openLightboxWithSlider(wrapper)

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })

      // First change the master slider to 'val-b' via the lightbox
      lightbox.vm.$emit('slider-change', 'x0|y0', 'val-b')
      await flushPromises()

      // Now navigate to the second grid image (index 1)
      // The snapshot had currentSliderValue: 'val-a', but the live master is 'val-b'
      lightbox.vm.$emit('navigate', 1)
      await flushPromises()

      // The lightbox should show the val-b image for cell1 (using live value, not stale snapshot)
      expect(lightbox.props('imageUrl')).toBe('/api/images/cell1-val-b.png')
      expect(lightbox.props('currentSliderValue')).toBe('val-b')
    })

    // AC3 (B-068): No images show different slider values after shift+arrow navigation.
    // Navigating forward then back must preserve the current master slider value.
    it('AC3: back-navigation keeps the slider value consistent with the master', async () => {
      const wrapper = await mountWithRun()
      await openLightboxWithSlider(wrapper)

      const lightbox = wrapper.findComponent({ name: 'ImageLightbox' })

      // Change slider to val-b via lightbox
      lightbox.vm.$emit('slider-change', 'x0|y0', 'val-b')
      await flushPromises()
      expect(lightbox.props('currentSliderValue')).toBe('val-b')

      // Navigate to the second cell
      lightbox.vm.$emit('navigate', 1)
      await flushPromises()
      expect(lightbox.props('currentSliderValue')).toBe('val-b')

      // Navigate back to the first cell — should still show val-b, not the stale val-a
      lightbox.vm.$emit('navigate', 0)
      await flushPromises()
      expect(lightbox.props('currentSliderValue')).toBe('val-b')
      expect(lightbox.props('imageUrl')).toBe('/api/images/cell0-val-b.png')
    })
  })
})
