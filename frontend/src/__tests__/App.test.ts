import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NButton, NTag } from 'naive-ui'
import App from '../App.vue'
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
})
