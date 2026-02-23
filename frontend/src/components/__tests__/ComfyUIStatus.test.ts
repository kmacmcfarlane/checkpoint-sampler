import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NTag } from 'naive-ui'
import ComfyUIStatus from '../ComfyUIStatus.vue'
import { apiClient } from '../../api/client'

vi.mock('../../api/client', () => ({
  apiClient: {
    getComfyUIStatus: vi.fn(),
  },
}))

describe('ComfyUIStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('is hidden when ComfyUI is not enabled', async () => {
    vi.mocked(apiClient.getComfyUIStatus).mockResolvedValue({
      enabled: false,
      connected: false,
    })

    const wrapper = mount(ComfyUIStatus)
    await flushPromises()

    const tag = wrapper.findComponent(NTag)
    expect(tag.exists()).toBe(false)
  })

  it('shows online status when enabled and connected', async () => {
    vi.mocked(apiClient.getComfyUIStatus).mockResolvedValue({
      enabled: true,
      connected: true,
    })

    const wrapper = mount(ComfyUIStatus)
    await flushPromises()

    const tag = wrapper.findComponent(NTag)
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toBe('ComfyUI')
    expect(tag.props('type')).toBe('success')
    expect(tag.attributes('title')).toBe('ComfyUI connected')
  })

  it('shows offline status when enabled but disconnected', async () => {
    vi.mocked(apiClient.getComfyUIStatus).mockResolvedValue({
      enabled: true,
      connected: false,
    })

    const wrapper = mount(ComfyUIStatus)
    await flushPromises()

    const tag = wrapper.findComponent(NTag)
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toBe('ComfyUI (offline)')
    expect(tag.props('type')).toBe('default')
    expect(tag.attributes('title')).toBe('ComfyUI disconnected')
  })

  it('polls status periodically', async () => {
    vi.mocked(apiClient.getComfyUIStatus).mockResolvedValue({
      enabled: true,
      connected: true,
    })

    mount(ComfyUIStatus)
    await flushPromises()

    expect(apiClient.getComfyUIStatus).toHaveBeenCalledTimes(1)

    // Advance time by 10 seconds
    vi.advanceTimersByTime(10000)
    await flushPromises()

    expect(apiClient.getComfyUIStatus).toHaveBeenCalledTimes(2)

    // Advance another 10 seconds
    vi.advanceTimersByTime(10000)
    await flushPromises()

    expect(apiClient.getComfyUIStatus).toHaveBeenCalledTimes(3)
  })

  it('handles API errors gracefully', async () => {
    vi.mocked(apiClient.getComfyUIStatus).mockRejectedValue(new Error('Network error'))

    const wrapper = mount(ComfyUIStatus)
    await flushPromises()

    // Should not throw and should hide the tag (enabled=false by default on error)
    const tag = wrapper.findComponent(NTag)
    expect(tag.exists()).toBe(false)
  })

  it('cleans up interval on unmount', async () => {
    vi.mocked(apiClient.getComfyUIStatus).mockResolvedValue({
      enabled: true,
      connected: true,
    })

    const wrapper = mount(ComfyUIStatus)
    await flushPromises()

    expect(apiClient.getComfyUIStatus).toHaveBeenCalledTimes(1)

    wrapper.unmount()

    // Advance time to verify interval is cleared
    vi.advanceTimersByTime(10000)
    await flushPromises()

    // Should still only have been called once (no additional calls after unmount)
    expect(apiClient.getComfyUIStatus).toHaveBeenCalledTimes(1)
  })
})
