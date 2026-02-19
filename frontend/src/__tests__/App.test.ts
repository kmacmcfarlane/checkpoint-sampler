import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../App.vue'

describe('App', () => {
  it('renders the application header', () => {
    const wrapper = mount(App)
    expect(wrapper.find('h1').text()).toBe('Checkpoint Sampler')
  })

  it('renders placeholder content', () => {
    const wrapper = mount(App)
    expect(wrapper.find('main').text()).toContain('Select a training run to get started.')
  })
})
