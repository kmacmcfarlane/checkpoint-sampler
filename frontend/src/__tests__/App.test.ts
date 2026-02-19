import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from '../App.vue'

vi.mock('../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn().mockResolvedValue([]),
  },
}))

describe('App', () => {
  it('renders the application header', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Checkpoint Sampler')
  })

  it('renders placeholder content when no training run is selected', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('main').text()).toContain('Select a training run to get started.')
  })

  it('renders the TrainingRunSelector component', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.training-run-selector').exists()).toBe(true)
  })
})
