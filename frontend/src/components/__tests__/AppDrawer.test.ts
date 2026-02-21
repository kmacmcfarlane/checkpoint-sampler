import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import AppDrawer from '../AppDrawer.vue'

let matchMediaListener: ((e: MediaQueryListEvent) => void) | null = null

function setupMatchMedia(matches: boolean) {
  matchMediaListener = null
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

async function mountDrawer(props: { show: boolean } = { show: true }, innerWidth = 1024) {
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true })
  const wrapper = mount(AppDrawer, {
    props,
    slots: {
      default: '<div class="test-content">Slot content</div>',
    },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
  await nextTick()
  return wrapper
}

describe('AppDrawer', () => {
  beforeEach(() => {
    setupMatchMedia(true) // Default: wide screen
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders NDrawer with left placement', async () => {
    const wrapper = await mountDrawer()
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.exists()).toBe(true)
    expect(drawer.props('placement')).toBe('left')
  })

  it('passes show prop to NDrawer', async () => {
    const wrapper = await mountDrawer({ show: true })
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('show')).toBe(true)
  })

  it('renders NDrawerContent with title and closable', async () => {
    const wrapper = await mountDrawer()
    const content = wrapper.findComponent(NDrawerContent)
    expect(content.exists()).toBe(true)
    expect(content.props('title')).toBe('Controls')
    expect(content.props('closable')).toBe(true)
  })

  it('renders slot content inside drawer', async () => {
    const wrapper = await mountDrawer()
    expect(wrapper.find('.test-content').exists()).toBe(true)
    expect(wrapper.find('.test-content').text()).toBe('Slot content')
  })

  it('emits update:show when NDrawer emits update:show', async () => {
    const wrapper = await mountDrawer()
    const drawer = wrapper.findComponent(NDrawer)
    drawer.vm.$emit('update:show', false)
    expect(wrapper.emitted('update:show')).toEqual([[false]])
  })

  it('does not render content when show is false', async () => {
    const wrapper = await mountDrawer({ show: false })
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('show')).toBe(false)
  })

  describe('responsive width', () => {
    it('uses 360px width on wide screens (>=768px)', async () => {
      setupMatchMedia(true)
      const wrapper = await mountDrawer({ show: true }, 1024)
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe(360)
    })

    it('uses 100% width on mobile screens (<768px)', async () => {
      setupMatchMedia(false)
      const wrapper = await mountDrawer({ show: true }, 600)
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe('100%')
    })

    it('responds to media query change from wide to narrow', async () => {
      setupMatchMedia(true)
      const wrapper = await mountDrawer({ show: true }, 1024)
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe(360)

      // Simulate viewport narrowing
      if (matchMediaListener) {
        matchMediaListener({ matches: false } as MediaQueryListEvent)
        await nextTick()
      }
      expect(drawer.props('width')).toBe('100%')
    })

    it('responds to media query change from narrow to wide', async () => {
      setupMatchMedia(false)
      const wrapper = await mountDrawer({ show: true }, 600)
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe('100%')

      // Simulate viewport widening
      if (matchMediaListener) {
        matchMediaListener({ matches: true } as MediaQueryListEvent)
        await nextTick()
      }
      expect(drawer.props('width')).toBe(360)
    })
  })
})
