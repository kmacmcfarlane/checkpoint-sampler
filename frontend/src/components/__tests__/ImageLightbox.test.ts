import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageLightbox from '../ImageLightbox.vue'

describe('ImageLightbox', () => {
  const defaultProps = {
    imageUrl: '/api/images/dir/image.png',
  }

  it('renders a dialog overlay with the image', () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Image lightbox"]').exists()).toBe(true)
    const img = wrapper.find('.lightbox-image')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/api/images/dir/image.png')
  })

  it('emits close when clicking the backdrop', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

    const backdrop = wrapper.find('.lightbox-backdrop')
    // Simulate clicking the backdrop itself (not a child)
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not emit close when clicking the image content area', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

    const content = wrapper.find('.lightbox-content')
    await content.trigger('click')
    // Click on content should not close (event target !== currentTarget on backdrop)
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('emits close on Escape key press', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

    // Simulate keyboard event on document
    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(event)

    expect(wrapper.emitted('close')).toBeTruthy()

    wrapper.unmount()
  })

  it('does not emit close on non-Escape key press', () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    document.dispatchEvent(event)

    expect(wrapper.emitted('close')).toBeFalsy()

    wrapper.unmount()
  })

  it('zooms in on wheel scroll up (negative deltaY)', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

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

    const imgAfter = wrapper.find('.lightbox-image')
    const styleAfter = imgAfter.attributes('style') ?? ''
    expect(styleAfter).toContain('scale(1)')
    expect(styleAfter).toContain('translate(0px, 0px)')
  })

  it('sets image as non-draggable', () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })

    const img = wrapper.find('.lightbox-image')
    expect(img.attributes('draggable')).toBe('false')
  })

  it('removes event listeners on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const wrapper = mount(ImageLightbox, { props: defaultProps })

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
})
