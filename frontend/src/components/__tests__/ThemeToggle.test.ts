import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { NButton } from 'naive-ui'
import ThemeToggle from '../ThemeToggle.vue'

describe('ThemeToggle', () => {
  it('renders "Dark" text when in light mode', () => {
    const wrapper = mount(ThemeToggle, {
      props: { isDark: false },
    })
    const button = wrapper.findComponent(NButton)
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('Dark')
  })

  it('renders "Light" text when in dark mode', () => {
    const wrapper = mount(ThemeToggle, {
      props: { isDark: true },
    })
    const button = wrapper.findComponent(NButton)
    expect(button.text()).toBe('Light')
  })

  it('emits toggle event when clicked', async () => {
    const wrapper = mount(ThemeToggle, {
      props: { isDark: false },
    })
    const button = wrapper.findComponent(NButton)
    await button.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('has accessible aria-label for light mode', () => {
    const wrapper = mount(ThemeToggle, {
      props: { isDark: false },
    })
    const button = wrapper.findComponent(NButton)
    expect(button.attributes('aria-label')).toBe('Switch to dark theme')
  })

  it('has accessible aria-label for dark mode', () => {
    const wrapper = mount(ThemeToggle, {
      props: { isDark: true },
    })
    const button = wrapper.findComponent(NButton)
    expect(button.attributes('aria-label')).toBe('Switch to light theme')
  })
})
