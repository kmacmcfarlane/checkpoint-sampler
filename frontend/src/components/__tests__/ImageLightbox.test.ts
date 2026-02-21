import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ImageLightbox from '../ImageLightbox.vue'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getImageMetadata: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'

const mockGetImageMetadata = apiClient.getImageMetadata as ReturnType<typeof vi.fn>

describe('ImageLightbox', () => {
  const defaultProps = {
    imageUrl: '/api/images/dir/image.png',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetImageMetadata.mockResolvedValue({ metadata: {} })
  })

  it('renders a dialog overlay with the image', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Image lightbox"]').exists()).toBe(true)
    const img = wrapper.find('.lightbox-image')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/api/images/dir/image.png')
  })

  it('emits close when clicking the backdrop', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const backdrop = wrapper.find('.lightbox-backdrop')
    // Simulate clicking the backdrop itself (not a child)
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not emit close when clicking the image content area', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const content = wrapper.find('.lightbox-content')
    await content.trigger('click')
    // Click on content should not close (event target !== currentTarget on backdrop)
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('emits close on Escape key press', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    // Simulate keyboard event on document
    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(event)

    expect(wrapper.emitted('close')).toBeTruthy()

    wrapper.unmount()
  })

  it('does not emit close on non-Escape key press', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    document.dispatchEvent(event)

    expect(wrapper.emitted('close')).toBeFalsy()

    wrapper.unmount()
  })

  it('zooms in on wheel scroll up (negative deltaY)', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const contentEl = wrapper.find('.lightbox-content').element
    const img = wrapper.find('.lightbox-image')

    // Initial transform should have scale(1)
    expect(img.attributes('style')).toContain('scale(1)')

    // Dispatch WheelEvent directly (trigger can't set read-only clientX/clientY)
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: 400,
      clientY: 300,
      bubbles: true,
      cancelable: true,
    })
    contentEl.dispatchEvent(wheelEvent)
    await wrapper.vm.$nextTick()

    const style = img.attributes('style') ?? ''
    // After zoom in, scale should be > 1
    const scaleMatch = style.match(/scale\(([^)]+)\)/)
    expect(scaleMatch).toBeTruthy()
    const scaleValue = parseFloat(scaleMatch![1])
    expect(scaleValue).toBeGreaterThan(1)
  })

  it('zooms out on wheel scroll down (positive deltaY)', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const contentEl = wrapper.find('.lightbox-content').element
    const img = wrapper.find('.lightbox-image')

    // Dispatch WheelEvent directly
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 100,
      clientX: 400,
      clientY: 300,
      bubbles: true,
      cancelable: true,
    })
    contentEl.dispatchEvent(wheelEvent)
    await wrapper.vm.$nextTick()

    const style = img.attributes('style') ?? ''
    const scaleMatch = style.match(/scale\(([^)]+)\)/)
    expect(scaleMatch).toBeTruthy()
    const scaleValue = parseFloat(scaleMatch![1])
    expect(scaleValue).toBeLessThan(1)
  })

  it('pans the image on mouse drag', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const content = wrapper.find('.lightbox-content')
    const img = wrapper.find('.lightbox-image')

    // Start dragging
    await content.trigger('mousedown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    })

    // Move the mouse (dispatched on document since the component listens there)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 150 }))
    await wrapper.vm.$nextTick()

    const style = img.attributes('style') ?? ''
    // Should have translated
    expect(style).toContain('translate(100px, 50px)')

    // Release
    document.dispatchEvent(new MouseEvent('mouseup'))
    await wrapper.vm.$nextTick()

    // Further mouse move should not change position
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200 }))
    await wrapper.vm.$nextTick()

    // Still the same translate values
    const styleAfter = img.attributes('style') ?? ''
    expect(styleAfter).toContain('translate(100px, 50px)')

    wrapper.unmount()
  })

  it('shows grab cursor by default and grabbing cursor while dragging', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const content = wrapper.find('.lightbox-content')
    const img = wrapper.find('.lightbox-image')

    // Default cursor: grab
    expect(img.attributes('style')).toContain('cursor: grab')

    // Start dragging
    await content.trigger('mousedown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    })

    await wrapper.vm.$nextTick()
    expect(img.attributes('style')).toContain('cursor: grabbing')

    // Stop dragging
    document.dispatchEvent(new MouseEvent('mouseup'))
    await wrapper.vm.$nextTick()

    expect(img.attributes('style')).toContain('cursor: grab')

    wrapper.unmount()
  })

  it('resets transform when imageUrl prop changes', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const contentEl = wrapper.find('.lightbox-content').element

    // Zoom in via WheelEvent
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: 400,
      clientY: 300,
      bubbles: true,
      cancelable: true,
    })
    contentEl.dispatchEvent(wheelEvent)
    await wrapper.vm.$nextTick()

    const imgBefore = wrapper.find('.lightbox-image')
    const styleBefore = imgBefore.attributes('style') ?? ''
    expect(styleBefore).not.toContain('scale(1)')

    // Change image URL
    await wrapper.setProps({ imageUrl: '/api/images/other/image.png' })
    await flushPromises()

    const imgAfter = wrapper.find('.lightbox-image')
    const styleAfter = imgAfter.attributes('style') ?? ''
    expect(styleAfter).toContain('scale(1)')
    expect(styleAfter).toContain('translate(0px, 0px)')
  })

  it('sets image as non-draggable', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const img = wrapper.find('.lightbox-image')
    expect(img.attributes('draggable')).toBe('false')
  })

  it('removes event listeners on unmount', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    // Should have added keydown, mousemove, mouseup listeners
    const addedEvents = addSpy.mock.calls.map((c) => c[0])
    expect(addedEvents).toContain('keydown')
    expect(addedEvents).toContain('mousemove')
    expect(addedEvents).toContain('mouseup')

    wrapper.unmount()

    // Should have removed them
    const removedEvents = removeSpy.mock.calls.map((c) => c[0])
    expect(removedEvents).toContain('keydown')
    expect(removedEvents).toContain('mousemove')
    expect(removedEvents).toContain('mouseup')

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('ignores right-click for dragging', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const content = wrapper.find('.lightbox-content')
    const img = wrapper.find('.lightbox-image')

    // Right click (button 2)
    await content.trigger('mousedown', {
      button: 2,
      clientX: 100,
      clientY: 100,
    })

    // Mouse move should not translate
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 150 }))
    await wrapper.vm.$nextTick()

    const style = img.attributes('style') ?? ''
    expect(style).toContain('translate(0px, 0px)')

    wrapper.unmount()
  })

  // --- Metadata tests ---

  it('fetches metadata on mount', async () => {
    mockGetImageMetadata.mockResolvedValue({ metadata: { prompt: '{}' } })

    mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    expect(mockGetImageMetadata).toHaveBeenCalledWith('dir/image.png')
  })

  it('renders metadata toggle button', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const toggle = wrapper.find('.metadata-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toBe('Show Metadata')
  })

  it('shows metadata content when toggle is clicked', async () => {
    mockGetImageMetadata.mockResolvedValue({
      metadata: { prompt: '{"nodes": []}', workflow: '{"links": []}' },
    })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const toggle = wrapper.find('.metadata-toggle')
    await toggle.trigger('click')

    expect(toggle.text()).toBe('Hide Metadata')
    expect(wrapper.find('.metadata-content').exists()).toBe(true)

    const entries = wrapper.findAll('.metadata-entry')
    expect(entries).toHaveLength(2)
  })

  it('displays metadata keys in sorted order', async () => {
    mockGetImageMetadata.mockResolvedValue({
      metadata: { workflow: '{}', prompt: '{}' },
    })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    const keys = wrapper.findAll('.metadata-key')
    expect(keys[0].text()).toBe('prompt')
    expect(keys[1].text()).toBe('workflow')
  })

  it('formats JSON values in metadata', async () => {
    mockGetImageMetadata.mockResolvedValue({
      metadata: { prompt: '{"key":"value"}' },
    })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    const value = wrapper.find('.metadata-value')
    // Should be formatted JSON
    expect(value.text()).toContain('"key"')
    expect(value.text()).toContain('"value"')
  })

  it('shows "No metadata available" when metadata is empty', async () => {
    mockGetImageMetadata.mockResolvedValue({ metadata: {} })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    expect(wrapper.find('.metadata-empty').exists()).toBe(true)
    expect(wrapper.find('.metadata-empty').text()).toBe('No metadata available')
  })

  it('shows loading state while fetching metadata', async () => {
    let resolveMetadata: (v: unknown) => void
    mockGetImageMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve
      }),
    )

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    // Don't flush - metadata is still loading

    await wrapper.find('.metadata-toggle').trigger('click')
    expect(wrapper.find('.metadata-loading').exists()).toBe(true)
    expect(wrapper.find('.metadata-loading').text()).toBe('Loading metadata...')

    resolveMetadata!({ metadata: {} })
    await flushPromises()

    expect(wrapper.find('.metadata-loading').exists()).toBe(false)
  })

  it('shows error state when metadata fetch fails', async () => {
    mockGetImageMetadata.mockRejectedValue({ code: 'NOT_FOUND', message: 'Image not found' })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    expect(wrapper.find('.metadata-error').exists()).toBe(true)
    expect(wrapper.find('.metadata-error').text()).toBe('Image not found')
  })

  it('re-fetches metadata when imageUrl changes', async () => {
    mockGetImageMetadata.mockResolvedValue({ metadata: { prompt: '{}' } })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    expect(mockGetImageMetadata).toHaveBeenCalledTimes(1)
    expect(mockGetImageMetadata).toHaveBeenCalledWith('dir/image.png')

    await wrapper.setProps({ imageUrl: '/api/images/other/dir/pic.png' })
    await flushPromises()

    expect(mockGetImageMetadata).toHaveBeenCalledTimes(2)
    expect(mockGetImageMetadata).toHaveBeenCalledWith('other/dir/pic.png')
  })

  it('does not interfere with zoom/pan when metadata panel is open', async () => {
    mockGetImageMetadata.mockResolvedValue({ metadata: { prompt: '{}' } })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    // Open metadata
    await wrapper.find('.metadata-toggle').trigger('click')
    expect(wrapper.find('.metadata-content').exists()).toBe(true)

    // Zoom should still work on the content area
    const contentEl = wrapper.find('.lightbox-content').element
    const img = wrapper.find('.lightbox-image')

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: 400,
      clientY: 300,
      bubbles: true,
      cancelable: true,
    })
    contentEl.dispatchEvent(wheelEvent)
    await wrapper.vm.$nextTick()

    const style = img.attributes('style') ?? ''
    const scaleMatch = style.match(/scale\(([^)]+)\)/)
    expect(scaleMatch).toBeTruthy()
    expect(parseFloat(scaleMatch![1])).toBeGreaterThan(1)
  })

  it('has accessible toggle button', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const toggle = wrapper.find('.metadata-toggle')
    expect(toggle.attributes('aria-label')).toBe('Toggle metadata')
  })

  it('metadata panel click does not close lightbox', async () => {
    mockGetImageMetadata.mockResolvedValue({ metadata: { prompt: '{}' } })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    // Click on the metadata panel should not close the lightbox
    const panel = wrapper.find('.metadata-panel')
    await panel.trigger('click')

    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('displays non-JSON values without formatting', async () => {
    mockGetImageMetadata.mockResolvedValue({
      metadata: { Comment: 'plain text value' },
    })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    const value = wrapper.find('.metadata-value')
    expect(value.text()).toBe('plain text value')
  })
})
