import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { NDrawer, NDrawerContent } from 'naive-ui'
import AppDrawer from '../AppDrawer.vue'

function mountDrawer(props: { show: boolean } = { show: true }) {
  return mount(AppDrawer, {
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
}

describe('AppDrawer', () => {
  it('renders NDrawer with left placement', () => {
    const wrapper = mountDrawer()
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.exists()).toBe(true)
    expect(drawer.props('placement')).toBe('left')
  })

  it('passes show prop to NDrawer', () => {
    const wrapper = mountDrawer({ show: true })
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('show')).toBe(true)
  })

  it('renders NDrawerContent with title and closable', () => {
    const wrapper = mountDrawer()
    const content = wrapper.findComponent(NDrawerContent)
    expect(content.exists()).toBe(true)
    expect(content.props('title')).toBe('Controls')
    expect(content.props('closable')).toBe(true)
  })

  it('renders slot content inside drawer', () => {
    const wrapper = mountDrawer()
    expect(wrapper.find('.test-content').exists()).toBe(true)
    expect(wrapper.find('.test-content').text()).toBe('Slot content')
  })

  it('emits update:show when NDrawer emits update:show', () => {
    const wrapper = mountDrawer()
    const drawer = wrapper.findComponent(NDrawer)
    drawer.vm.$emit('update:show', false)
    expect(wrapper.emitted('update:show')).toEqual([[false]])
  })

  it('does not render content when show is false', () => {
    const wrapper = mountDrawer({ show: false })
    const drawer = wrapper.findComponent(NDrawer)
    expect(drawer.props('show')).toBe(false)
  })
})
