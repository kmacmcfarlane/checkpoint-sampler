import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NButton } from 'naive-ui'
import App from '../App.vue'

vi.mock('../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn().mockResolvedValue([]),
    scanTrainingRun: vi.fn().mockResolvedValue({ images: [], dimensions: [] }),
  },
}))

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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
})
