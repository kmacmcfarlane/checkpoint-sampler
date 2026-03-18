import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ImageLightbox from '../ImageLightbox.vue'
import SliderBar from '../SliderBar.vue'
import DebugOverlay from '../DebugOverlay.vue'
import type { DebugCellInfo } from '../types'

// enableAutoUnmount is configured globally in vitest.setup.ts

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
    cellKey: null,
    sliderValues: [],
    currentSliderValue: '',
    imagesBySliderValue: {},
    sliderDimensionName: '',
    gridImages: [],
    gridIndex: 0,
    gridColumnCount: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetImageMetadata.mockResolvedValue({ string_metadata: {}, numeric_metadata: {} })
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

  it('emits close when clicking the backdrop directly', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const backdrop = wrapper.find('.lightbox-backdrop')
    // Full click: mousedown then click both on the backdrop itself
    await backdrop.trigger('mousedown')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when clicking the content area background (outside the image)', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const content = wrapper.find('.lightbox-content')
    // Full click: mousedown then click both on the content background
    await content.trigger('mousedown', { button: 0 })
    await content.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not emit close when clicking the image itself', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const img = wrapper.find('.lightbox-image')
    await img.trigger('click')
    // Click on the image should not close (event target !== currentTarget on content)
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('emits close when clicking the X close button', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const closeBtn = wrapper.find('.lightbox-close')
    expect(closeBtn.exists()).toBe(true)
    expect(closeBtn.attributes('aria-label')).toBe('Close lightbox')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('renders X close button in the top-left corner', async () => {
    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    const closeBtn = wrapper.find('.lightbox-close')
    expect(closeBtn.exists()).toBe(true)
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
    mockGetImageMetadata.mockResolvedValue({ string_metadata: { prompt: '{}' }, numeric_metadata: {} })

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
      string_metadata: { prompt: '{"nodes": []}', workflow: '{"links": []}' },
      numeric_metadata: {},
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
      string_metadata: { workflow: '{}', prompt: '{}' },
      numeric_metadata: {},
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
      string_metadata: { prompt: '{"key":"value"}' },
      numeric_metadata: {},
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
    mockGetImageMetadata.mockResolvedValue({ string_metadata: {}, numeric_metadata: {} })

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

    resolveMetadata!({ string_metadata: {}, numeric_metadata: {} })
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
    mockGetImageMetadata.mockResolvedValue({ string_metadata: { prompt: '{}' }, numeric_metadata: {} })

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
    mockGetImageMetadata.mockResolvedValue({ string_metadata: { prompt: '{}' }, numeric_metadata: {} })

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
    mockGetImageMetadata.mockResolvedValue({ string_metadata: { prompt: '{}' }, numeric_metadata: {} })

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
      string_metadata: { Comment: 'plain text value' },
      numeric_metadata: {},
    })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    const value = wrapper.find('.metadata-value')
    expect(value.text()).toBe('plain text value')
  })

  it('displays numeric metadata fields (seed, steps, cfg) as numbers', async () => {
    mockGetImageMetadata.mockResolvedValue({
      string_metadata: { sampler_name: 'euler' },
      numeric_metadata: { seed: 42, steps: 20, cfg: 7.5 },
    })

    const wrapper = mount(ImageLightbox, { props: defaultProps })
    await flushPromises()

    await wrapper.find('.metadata-toggle').trigger('click')

    const entries = wrapper.findAll('.metadata-entry')
    // 1 string field + 3 numeric fields = 4 total
    expect(entries).toHaveLength(4)

    // Find the cfg entry and verify it displays numerically
    const keys = wrapper.findAll('.metadata-key')
    const values = wrapper.findAll('.metadata-value')
    const cfgIdx = Array.from(keys).findIndex((k) => k.text() === 'cfg')
    expect(cfgIdx).toBeGreaterThanOrEqual(0)
    expect(values[cfgIdx].text()).toBe('7.5')
  })

  // --- Mouse-down origin tracking (B-033: slider drag release should not close) ---

  describe('mousedown origin guard', () => {
    it('does not close when mousedown is on a child element and mouseup is on the backdrop', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const backdrop = wrapper.find('.lightbox-backdrop')
      const closeBtn = wrapper.find('.lightbox-close')

      // Simulate a drag: mousedown starts on the close button (a child), but click fires on the backdrop
      // (This happens when the user releases the mouse over the backdrop after dragging from inside)
      await closeBtn.trigger('mousedown')
      // The backdrop receives the click event from the browser when mouseup lands on it
      await backdrop.trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })

    it('does not close when mousedown is on a child element and click fires on the content background', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const content = wrapper.find('.lightbox-content')
      const img = wrapper.find('.lightbox-image')

      // Mousedown on the image (child), then click fires on the content background
      // (simulates releasing the mouse over the content area after dragging from the image)
      await img.trigger('mousedown', { button: 0 })
      await content.trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })

    it('does not close when mousedown originates outside the backdrop (e.g. slider drag)', async () => {
      const sliderProps = {
        imageUrl: '/api/images/seed=42&step=500&cfg=3.png',
        cellKey: '42|500',
        sliderValues: ['3', '7', '15'],
        currentSliderValue: '7',
        imagesBySliderValue: {
          '3': '/api/images/seed=42&step=500&cfg=3.png',
          '7': '/api/images/seed=42&step=500&cfg=7.png',
          '15': '/api/images/seed=42&step=500&cfg=15.png',
        },
        sliderDimensionName: 'cfg',
        gridImages: [],
        gridIndex: 0,
        gridColumnCount: 0,
      }
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      const backdrop = wrapper.find('.lightbox-backdrop')
      const sliderPanel = wrapper.find('.lightbox-slider-panel')

      // Mousedown starts on the slider panel (outside the backdrop's own target check),
      // then the browser fires click on the backdrop when mouse is released there.
      await sliderPanel.trigger('mousedown')
      // No mousedown was recorded on the backdrop itself, so click should NOT close.
      await backdrop.trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })

    it('still closes on normal background click (mousedown + click both on backdrop)', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const backdrop = wrapper.find('.lightbox-backdrop')

      // Normal click: both mousedown and click originate on the backdrop itself
      await backdrop.trigger('mousedown')
      await backdrop.trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('still closes on normal content background click (mousedown + click both on content)', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const content = wrapper.find('.lightbox-content')

      // Normal click: both mousedown and click originate on the content background
      await content.trigger('mousedown', { button: 0 })
      await content.trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('clears mousedown target after each click so subsequent interactions start fresh', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const backdrop = wrapper.find('.lightbox-backdrop')

      // First: a drag that should NOT close (mousedown on child, click on backdrop)
      const closeBtn = wrapper.find('.lightbox-close')
      await closeBtn.trigger('mousedown')
      await backdrop.trigger('click')
      expect(wrapper.emitted('close')).toBeFalsy()

      // Second: a real click that SHOULD close (mousedown + click both on backdrop)
      await backdrop.trigger('mousedown')
      await backdrop.trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  // --- Lightbox slider tests ---

  describe('slider navigation', () => {
    const sliderProps = {
      imageUrl: '/api/images/seed=42&step=500&cfg=3.png',
      cellKey: '42|500',
      sliderValues: ['3', '7', '15'],
      currentSliderValue: '7',
      imagesBySliderValue: {
        '3': '/api/images/seed=42&step=500&cfg=3.png',
        '7': '/api/images/seed=42&step=500&cfg=7.png',
        '15': '/api/images/seed=42&step=500&cfg=15.png',
      },
      sliderDimensionName: 'cfg',
      gridImages: [],
      gridIndex: 0,
      gridColumnCount: 0,
    }

    it('renders a SliderBar when slider dimension values are provided', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(true)
    })

    it('does not render SliderBar when sliderValues is empty', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(false)
    })

    it('does not render SliderBar when cellKey is null even if sliderValues are provided', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...sliderProps, cellKey: null },
      })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(false)
    })

    it('passes the correct values and currentValue to SliderBar', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.props('values')).toEqual(['3', '7', '15'])
      expect(slider.props('currentValue')).toBe('7')
    })

    it('emits slider-change with cellKey and new value when SliderBar changes', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      slider.vm.$emit('change', '15')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['42|500', '15'])
    })

    it('zoom and pan still work when slider is present', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

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

    it('metadata panel still works when slider is present', async () => {
      mockGetImageMetadata.mockResolvedValue({ string_metadata: { prompt: '{}' }, numeric_metadata: {} })

      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      await wrapper.find('.metadata-toggle').trigger('click')
      expect(wrapper.find('.metadata-content').exists()).toBe(true)
    })

    // AC: B-069 — metadata panel does not overlap the slider panel
    it('adds above-slider class to metadata-panel when slider is visible (B-069)', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      const panel = wrapper.find('.metadata-panel')
      expect(panel.classes()).toContain('metadata-panel--above-slider')
    })

    it('does not add above-slider class to metadata-panel when no slider (B-069)', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const panel = wrapper.find('.metadata-panel')
      expect(panel.classes()).not.toContain('metadata-panel--above-slider')
    })

    it('does not add above-slider class when cellKey is null even with slider values (B-069)', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...sliderProps, cellKey: null },
      })
      await flushPromises()

      const panel = wrapper.find('.metadata-panel')
      expect(panel.classes()).not.toContain('metadata-panel--above-slider')
    })

    it('does not render SliderBar when sliderValues has only one value', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          ...sliderProps,
          sliderValues: ['3'],
          currentSliderValue: '3',
        },
      })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(false)
    })

    it('preloads adjacent slider images on mount', async () => {
      const imageSpy = vi.spyOn(globalThis, 'Image').mockImplementation(() => {
        return { src: '' } as HTMLImageElement
      })

      mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      // Current value is '7' (index 1), so adjacent are '3' (index 0) and '15' (index 2)
      const createdImages = imageSpy.mock.results.map((r) => (r.value as { src: string }).src)
      expect(createdImages).toContain('/api/images/seed=42&step=500&cfg=3.png')
      expect(createdImages).toContain('/api/images/seed=42&step=500&cfg=15.png')

      imageSpy.mockRestore()
    })

    it('emits slider-change on ArrowRight via document keydown without requiring focus', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      // currentSliderValue is '7' (index 1), ArrowRight should go to '15' (index 2)
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['42|500', '15'])

      wrapper.unmount()
    })

    it('emits slider-change on ArrowLeft via document keydown without requiring focus', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      // currentSliderValue is '7' (index 1), ArrowLeft should go to '3' (index 0)
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['42|500', '3'])

      wrapper.unmount()
    })

    it('does not emit slider-change on ArrowRight at last slider value', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...sliderProps, currentSliderValue: '15' },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('slider-change')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit slider-change on ArrowLeft at first slider value', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...sliderProps, currentSliderValue: '3' },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('slider-change')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit slider-change on arrow keys when no slider is shown', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('slider-change')).toBeUndefined()

      wrapper.unmount()
    })

    // AC: Regular ArrowLeft/ArrowRight advance sequentially even when the parent has not yet
    // re-rendered to update currentSliderValue (rapid/auto-repeat key presses, non-uniform intervals).
    it('advances sequentially on rapid ArrowRight presses without prop updates (non-uniform intervals)', async () => {
      // Non-uniform checkpoint values: intervals are 1000, 2500 — different spacings.
      const nonUniformProps = {
        imageUrl: '/api/images/ckpt=1000.png',
        cellKey: '42|500',
        sliderValues: ['1000', '2000', '4500'],
        currentSliderValue: '1000',
        imagesBySliderValue: {
          '1000': '/api/images/ckpt=1000.png',
          '2000': '/api/images/ckpt=2000.png',
          '4500': '/api/images/ckpt=4500.png',
        },
        sliderDimensionName: 'checkpoint',
        gridImages: [],
        gridIndex: 0,
        gridColumnCount: 0,
      }

      const wrapper = mount(ImageLightbox, { props: nonUniformProps })
      await flushPromises()

      // Press ArrowRight once: 1000 → 2000 (index 0 → 1)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      // Do NOT await nextTick or update props — simulate rapid second press before parent re-renders
      // Press ArrowRight again: should advance from 2000 → 4500 (index 1 → 2),
      // NOT re-emit 2000 due to stale props.currentSliderValue.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(2)
      // First press: 1000 → 2000
      expect(emitted![0]).toEqual(['42|500', '2000'])
      // Second press: 2000 → 4500 (local index advanced, not stuck at 2000)
      expect(emitted![1]).toEqual(['42|500', '4500'])

      wrapper.unmount()
    })

    it('advances sequentially on rapid ArrowLeft presses without prop updates', async () => {
      const nonUniformProps = {
        imageUrl: '/api/images/ckpt=4500.png',
        cellKey: '42|500',
        sliderValues: ['1000', '2000', '4500'],
        currentSliderValue: '4500',
        imagesBySliderValue: {
          '1000': '/api/images/ckpt=1000.png',
          '2000': '/api/images/ckpt=2000.png',
          '4500': '/api/images/ckpt=4500.png',
        },
        sliderDimensionName: 'checkpoint',
        gridImages: [],
        gridIndex: 0,
        gridColumnCount: 0,
      }

      const wrapper = mount(ImageLightbox, { props: nonUniformProps })
      await flushPromises()

      // Press ArrowLeft twice rapidly without prop update in between
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(2)
      // First press: 4500 → 2000 (index 2 → 1)
      expect(emitted![0]).toEqual(['42|500', '2000'])
      // Second press: 2000 → 1000 (index 1 → 0), not stuck at 2000
      expect(emitted![1]).toEqual(['42|500', '1000'])

      wrapper.unmount()
    })

    it('does not overshoot past last value on rapid ArrowRight presses', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...sliderProps, currentSliderValue: '7' },
      })
      await flushPromises()

      // Press ArrowRight twice rapidly: first goes to '15' (last), second should not overshoot
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      // Only one emission: first press advances to '15', second is clamped at boundary
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['42|500', '15'])

      wrapper.unmount()
    })

    it('resets local slider index when currentSliderValue prop changes externally', async () => {
      const wrapper = mount(ImageLightbox, { props: sliderProps })
      await flushPromises()

      // Simulate external update (e.g. MasterSlider changes the value)
      await wrapper.setProps({ currentSliderValue: '15' })
      await wrapper.vm.$nextTick()

      // ArrowLeft should now go back from '15' to '7' (index 2 → 1)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('slider-change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['42|500', '7'])

      wrapper.unmount()
    })
  })

  // --- Grid navigation tests (Shift+Arrow) ---

  describe('grid navigation', () => {
    const gridImages = [
      {
        imageUrl: '/api/images/a.png',
        cellKey: '42|500',
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
      },
      {
        imageUrl: '/api/images/b.png',
        cellKey: '123|500',
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
      },
      {
        imageUrl: '/api/images/c.png',
        cellKey: '42|1000',
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
      },
    ]

    const navProps = {
      ...defaultProps,
      imageUrl: '/api/images/b.png',
      gridImages,
      gridIndex: 1,
      gridColumnCount: 0,
    }

    it('emits navigate with previous index on Shift+ArrowLeft', async () => {
      const wrapper = mount(ImageLightbox, { props: navProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual([0])

      wrapper.unmount()
    })

    it('emits navigate with next index on Shift+ArrowRight', async () => {
      const wrapper = mount(ImageLightbox, { props: navProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual([2])

      wrapper.unmount()
    })

    it('wraps around to last image when Shift+ArrowLeft at first index', async () => {
      const wrapper = mount(ImageLightbox, { props: { ...navProps, gridIndex: 0 } })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      // Should wrap to last index (2)
      expect(emitted![0]).toEqual([2])

      wrapper.unmount()
    })

    it('wraps around to first image when Shift+ArrowRight at last index', async () => {
      const wrapper = mount(ImageLightbox, { props: { ...navProps, gridIndex: 2 } })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      // Should wrap to index 0
      expect(emitted![0]).toEqual([0])

      wrapper.unmount()
    })

    it('does not emit navigate when gridImages is empty', async () => {
      const wrapper = mount(ImageLightbox, { props: { ...navProps, gridImages: [], gridIndex: 0 } })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit navigate on plain ArrowLeft (without Shift)', async () => {
      // Plain ArrowLeft should only affect the slider (or do nothing if no slider)
      const wrapper = mount(ImageLightbox, { props: navProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: false, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit navigate on plain ArrowRight (without Shift)', async () => {
      const wrapper = mount(ImageLightbox, { props: navProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: false, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('Shift+ArrowLeft does not also emit slider-change', async () => {
      // Even if slider is present, Shift+Arrow should only navigate grid, not also change slider
      const sliderAndNavProps = {
        imageUrl: '/api/images/b.png',
        cellKey: '123|500',
        sliderValues: ['3', '7', '15'],
        currentSliderValue: '7',
        imagesBySliderValue: {
          '3': '/api/images/b-cfg3.png',
          '7': '/api/images/b-cfg7.png',
          '15': '/api/images/b-cfg15.png',
        },
        sliderDimensionName: 'cfg',
        gridImages,
        gridIndex: 1,
        gridColumnCount: 0,
      }
      const wrapper = mount(ImageLightbox, { props: sliderAndNavProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeDefined()
      expect(wrapper.emitted('slider-change')).toBeUndefined()

      wrapper.unmount()
    })
  })

  // --- Y-axis grid navigation tests (Shift+Up/Down) ---

  describe('Y-axis grid navigation', () => {
    // Simulate a 2-column (X), 2-row (Y) grid (row-major order):
    // index 0: (x=a, y=row1), index 1: (x=b, y=row1)
    // index 2: (x=a, y=row2), index 3: (x=b, y=row2)
    const gridImages2x2 = [
      { imageUrl: '/api/images/a-r1.png', cellKey: 'a|row1', sliderValues: [], currentSliderValue: '', imagesBySliderValue: {} },
      { imageUrl: '/api/images/b-r1.png', cellKey: 'b|row1', sliderValues: [], currentSliderValue: '', imagesBySliderValue: {} },
      { imageUrl: '/api/images/a-r2.png', cellKey: 'a|row2', sliderValues: [], currentSliderValue: '', imagesBySliderValue: {} },
      { imageUrl: '/api/images/b-r2.png', cellKey: 'b|row2', sliderValues: [], currentSliderValue: '', imagesBySliderValue: {} },
    ]

    // AC: Shift+Down navigates to the image below in the Y axis
    it('emits navigate with index+cols on Shift+ArrowDown (move down one row)', async () => {
      // Start at index 0 (top-left cell), column count = 2
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 0, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      // index 0 + 2 cols = index 2 (same X column, next Y row)
      expect(emitted![0]).toEqual([2])

      wrapper.unmount()
    })

    // AC: Shift+Up navigates to the image above in the Y axis
    it('emits navigate with index-cols on Shift+ArrowUp (move up one row)', async () => {
      // Start at index 3 (bottom-right cell), column count = 2
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 3, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      // index 3 - 2 cols = index 1 (same X column, previous Y row)
      expect(emitted![0]).toEqual([1])

      wrapper.unmount()
    })

    // AC: Navigation wraps at grid boundaries (consistent with X-axis behavior)
    it('wraps to last row on Shift+ArrowUp at top row', async () => {
      // Start at index 0 (top-left cell), column count = 2
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 0, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      // (0 - 2 + 4) % 4 = 2 (same X column, last row)
      expect(emitted![0]).toEqual([2])

      wrapper.unmount()
    })

    it('wraps to first row on Shift+ArrowDown at bottom row', async () => {
      // Start at index 2 (bottom-left cell), column count = 2
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 2, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      // (2 + 2) % 4 = 0 (same X column, first row)
      expect(emitted![0]).toEqual([0])

      wrapper.unmount()
    })

    // AC: No Y navigation when gridColumnCount is 0 (Y-only or flat mode)
    it('does not emit navigate on Shift+ArrowUp when gridColumnCount is 0', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 2, gridColumnCount: 0 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit navigate on Shift+ArrowDown when gridColumnCount is 0', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 0, gridColumnCount: 0 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit navigate on Shift+ArrowUp when gridImages is empty', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: [], gridIndex: 0, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit navigate on plain ArrowUp (without Shift)', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 2, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    it('does not emit navigate on plain ArrowDown (without Shift)', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 0, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeUndefined()

      wrapper.unmount()
    })

    // AC: Existing X-axis navigation is unchanged
    it('Shift+ArrowRight still navigates X axis correctly when gridColumnCount is set', async () => {
      // Start at index 0, column count = 2 → Shift+Right goes to index 1
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: gridImages2x2, gridIndex: 0, gridColumnCount: 2 },
      })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('navigate')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual([1])

      wrapper.unmount()
    })

    // AC: Test with different Y dimensions (3 rows, 3 columns = 9 items)
    it('navigates correctly in a 3x3 grid', async () => {
      const grid3x3 = Array.from({ length: 9 }, (_, i) => ({
        imageUrl: `/api/images/img${i}.png`,
        cellKey: `x${i % 3}|y${Math.floor(i / 3)}`,
        sliderValues: [] as string[],
        currentSliderValue: '',
        imagesBySliderValue: {} as Record<string, string>,
      }))

      // Start at index 4 (center), column count = 3
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: grid3x3, gridIndex: 4, gridColumnCount: 3 },
      })
      await flushPromises()

      // Shift+Down: 4 + 3 = 7
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }))
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('navigate')![0]).toEqual([7])

      wrapper.unmount()
    })

    it('Shift+ArrowDown does not also emit slider-change', async () => {
      const sliderAndNavProps = {
        ...defaultProps,
        imageUrl: '/api/images/a-r1.png',
        cellKey: 'a|row1',
        sliderValues: ['3', '7', '15'],
        currentSliderValue: '7',
        imagesBySliderValue: {
          '3': '/api/images/a-r1-cfg3.png',
          '7': '/api/images/a-r1-cfg7.png',
          '15': '/api/images/a-r1-cfg15.png',
        },
        sliderDimensionName: 'cfg',
        gridImages: gridImages2x2,
        gridIndex: 0,
        gridColumnCount: 2,
      }
      const wrapper = mount(ImageLightbox, { props: sliderAndNavProps })
      await flushPromises()

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('navigate')).toBeDefined()
      expect(wrapper.emitted('slider-change')).toBeUndefined()

      wrapper.unmount()
    })
  })

  // --- Slider dimension label tests ---

  describe('slider dimension label', () => {
    it('passes sliderDimensionName as label to SliderBar', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          imageUrl: '/api/images/seed=42&step=500&cfg=7.png',
          cellKey: '42|500',
          sliderValues: ['3', '7', '15'],
          currentSliderValue: '7',
          imagesBySliderValue: {
            '3': '/api/images/seed=42&step=500&cfg=3.png',
            '7': '/api/images/seed=42&step=500&cfg=7.png',
            '15': '/api/images/seed=42&step=500&cfg=15.png',
          },
          sliderDimensionName: 'cfg',
          gridImages: [],
          gridIndex: 0,
          gridColumnCount: 0,
        },
      })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(true)
      expect(slider.props('label')).toBe('cfg')

      wrapper.unmount()
    })

    it('passes checkpoint as slider label when sliderDimensionName is checkpoint', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          imageUrl: '/api/images/checkpoint=v1&seed=42.png',
          cellKey: '42|',
          sliderValues: ['v1', 'v2', 'v3'],
          currentSliderValue: 'v2',
          imagesBySliderValue: {
            v1: '/api/images/checkpoint=v1&seed=42.png',
            v2: '/api/images/checkpoint=v2&seed=42.png',
            v3: '/api/images/checkpoint=v3&seed=42.png',
          },
          sliderDimensionName: 'checkpoint',
          gridImages: [],
          gridIndex: 0,
          gridColumnCount: 0,
        },
      })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(true)
      expect(slider.props('label')).toBe('checkpoint')

      wrapper.unmount()
    })

    it('falls back to "Slider" label when sliderDimensionName is empty string', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          imageUrl: '/api/images/seed=42&step=500&cfg=7.png',
          cellKey: '42|500',
          sliderValues: ['3', '7', '15'],
          currentSliderValue: '7',
          imagesBySliderValue: {
            '3': '/api/images/seed=42&step=500&cfg=3.png',
            '7': '/api/images/seed=42&step=500&cfg=7.png',
            '15': '/api/images/seed=42&step=500&cfg=15.png',
          },
          sliderDimensionName: '',
          gridImages: [],
          gridIndex: 0,
          gridColumnCount: 0,
        },
      })
      await flushPromises()

      const slider = wrapper.findComponent(SliderBar)
      expect(slider.exists()).toBe(true)
      expect(slider.props('label')).toBe('Slider')

      wrapper.unmount()
    })
  })

  // --- Debug overlay tests (S-100) ---

  describe('debug overlay', () => {
    const debugInfo: DebugCellInfo = {
      xValue: '1000',
      yValue: 'landscape',
      sliderValue: '7',
      sliderDimensionName: 'cfg',
      comboSelections: { seed: ['42'] },
    }

    // AC1: When debug mode is enabled, the lightbox displays a params overlay on the current image
    it('renders DebugOverlay when debugMode is true and debugInfo is provided', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: true, debugInfo },
      })
      await flushPromises()

      const overlay = wrapper.findComponent(DebugOverlay)
      expect(overlay.exists()).toBe(true)
      expect(overlay.attributes('data-testid')).toBe('lightbox-debug-overlay')
    })

    // AC4: When debug mode is disabled, no overlay is shown
    it('does not render DebugOverlay when debugMode is false', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: false, debugInfo },
      })
      await flushPromises()

      const overlay = wrapper.findComponent(DebugOverlay)
      expect(overlay.exists()).toBe(false)
    })

    // AC4: When debug mode is omitted (default), no overlay is shown
    it('does not render DebugOverlay when debugMode is omitted', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps },
      })
      await flushPromises()

      const overlay = wrapper.findComponent(DebugOverlay)
      expect(overlay.exists()).toBe(false)
    })

    // AC4: When debugInfo is not provided but debugMode is true, no overlay is shown
    it('does not render DebugOverlay when debugMode is true but debugInfo is missing', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: true },
      })
      await flushPromises()

      const overlay = wrapper.findComponent(DebugOverlay)
      expect(overlay.exists()).toBe(false)
    })

    // AC2: Overlay shows the same parameter information as the XY grid debug overlay
    it('passes the debugInfo to DebugOverlay correctly', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: true, debugInfo },
      })
      await flushPromises()

      const overlay = wrapper.findComponent(DebugOverlay)
      expect(overlay.exists()).toBe(true)
      expect(overlay.props('info')).toEqual(debugInfo)
    })

    // AC2: Overlay renders x, y, slider, and combo values
    it('DebugOverlay displays x, y, slider, and combo values from debugInfo', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: true, debugInfo },
      })
      await flushPromises()

      const xRow = wrapper.find('[data-testid="debug-x-value"]')
      expect(xRow.exists()).toBe(true)
      expect(xRow.text()).toContain('1000')

      const yRow = wrapper.find('[data-testid="debug-y-value"]')
      expect(yRow.exists()).toBe(true)
      expect(yRow.text()).toContain('landscape')

      const sliderRow = wrapper.find('[data-testid="debug-slider-value"]')
      expect(sliderRow.exists()).toBe(true)
      expect(sliderRow.text()).toContain('cfg:')
      expect(sliderRow.text()).toContain('7')

      const comboRows = wrapper.findAll('[data-testid="debug-combo-value"]')
      expect(comboRows.length).toBe(1)
      expect(comboRows[0].text()).toContain('seed:')
      expect(comboRows[0].text()).toContain('42')
    })

    // AC5: Unit test for overlay visibility toggle
    it('shows overlay when debugMode is toggled from false to true', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: false, debugInfo },
      })
      await flushPromises()

      expect(wrapper.findComponent(DebugOverlay).exists()).toBe(false)

      await wrapper.setProps({ debugMode: true })
      await wrapper.vm.$nextTick()

      expect(wrapper.findComponent(DebugOverlay).exists()).toBe(true)
    })

    // AC5: Unit test for overlay visibility toggle (reverse)
    it('hides overlay when debugMode is toggled from true to false', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, debugMode: true, debugInfo },
      })
      await flushPromises()

      expect(wrapper.findComponent(DebugOverlay).exists()).toBe(true)

      await wrapper.setProps({ debugMode: false })
      await wrapper.vm.$nextTick()

      expect(wrapper.findComponent(DebugOverlay).exists()).toBe(false)
    })
  })

  // --- Keyboard shortcuts help overlay (S-109) ---

  describe('keyboard shortcuts help overlay', () => {
    // AC1: Lightbox includes a keyboard shortcuts help button
    it('renders the shortcuts help button in the lightbox', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const btn = wrapper.find('[data-testid="lightbox-shortcuts-btn"]')
      expect(btn.exists()).toBe(true)
      expect(btn.attributes('aria-label')).toBe('Toggle keyboard shortcuts')
    })

    // AC3: Help panel is initially hidden (unobtrusive)
    it('does not show shortcuts panel on initial render', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(false)
    })

    // AC4: Clicking help button shows the shortcuts panel
    it('shows shortcuts panel when help button is clicked', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      await wrapper.find('[data-testid="lightbox-shortcuts-btn"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(true)
    })

    // AC3: Help panel is dismissible by clicking the button again
    it('hides shortcuts panel when help button is clicked a second time', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const btn = wrapper.find('[data-testid="lightbox-shortcuts-btn"]')
      await btn.trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(true)

      await btn.trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(false)
    })

    // AC2: Panel lists expected keyboard shortcuts
    it('shortcuts panel lists Escape, Shift+Arrow grid nav, and plain Arrow slider shortcuts', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      await wrapper.find('[data-testid="lightbox-shortcuts-btn"]').trigger('click')
      await wrapper.vm.$nextTick()

      const panel = wrapper.find('[data-testid="lightbox-shortcuts-panel"]')
      const text = panel.text()

      // AC: Lists all shortcuts
      expect(text).toContain('Esc')
      expect(text).toContain('Close lightbox')
      expect(text).toContain('Shift')
      expect(text).toContain('Navigate grid')
      expect(text).toContain('Slider')
    })

    // AC3: Clicking shortcuts area does not close the lightbox
    it('clicking the shortcuts area does not close the lightbox', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      const area = wrapper.find('.lightbox-shortcuts-area')
      await area.trigger('click')

      expect(wrapper.emitted('close')).toBeFalsy()
    })

    // AC: '?' hotkey toggles the shortcuts panel open
    it('pressing ? key opens the shortcuts panel', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      // Panel should be hidden initially
      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(false)

      // Press '?' key
      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      // Panel should now be visible
      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(true)

      wrapper.unmount()
    })

    // AC: '?' hotkey toggles the shortcuts panel closed when already open
    it('pressing ? key closes the shortcuts panel when it is open', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      // Open the panel via button click first
      await wrapper.find('[data-testid="lightbox-shortcuts-btn"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(true)

      // Press '?' key to close
      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await wrapper.vm.$nextTick()

      // Panel should be hidden again
      expect(wrapper.find('[data-testid="lightbox-shortcuts-panel"]').exists()).toBe(false)

      wrapper.unmount()
    })

    // AC: shortcuts panel lists the '?' shortcut for toggling the help panel
    it('shortcuts panel lists the ? shortcut for toggling help', async () => {
      const wrapper = mount(ImageLightbox, { props: defaultProps })
      await flushPromises()

      await wrapper.find('[data-testid="lightbox-shortcuts-btn"]').trigger('click')
      await wrapper.vm.$nextTick()

      const panel = wrapper.find('[data-testid="lightbox-shortcuts-panel"]')
      expect(panel.text()).toContain('Toggle this help panel')
    })
  })

  // --- Grid position indicator tests (S-118) ---

  describe('grid position indicator', () => {
    const makeGridImages = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        imageUrl: `/api/images/img${i}.png`,
        cellKey: `key${i}`,
        sliderValues: [],
        currentSliderValue: '',
        imagesBySliderValue: {},
      }))

    // AC: Indicator renders with correct position text
    it('renders position indicator showing "1 / N" for the first image in a multi-image grid', async () => {
      const gridImages = makeGridImages(5)
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages, gridIndex: 0 },
      })
      await flushPromises()

      const indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.exists()).toBe(true)
      expect(indicator.text()).toBe('1 / 5')
    })

    // AC: Indicator renders correct position for a middle image
    it('renders position indicator with correct current position for mid-grid index', async () => {
      const gridImages = makeGridImages(12)
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages, gridIndex: 2 },
      })
      await flushPromises()

      const indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.exists()).toBe(true)
      expect(indicator.text()).toBe('3 / 12')
    })

    // AC: Indicator renders correct position for the last image (edge case)
    it('renders position indicator for the last image', async () => {
      const gridImages = makeGridImages(4)
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages, gridIndex: 3 },
      })
      await flushPromises()

      const indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.exists()).toBe(true)
      expect(indicator.text()).toBe('4 / 4')
    })

    // AC: Indicator updates when gridIndex prop changes (Shift+Arrow navigation)
    it('updates position text reactively when gridIndex prop changes', async () => {
      const gridImages = makeGridImages(6)
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages, gridIndex: 0 },
      })
      await flushPromises()

      let indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.text()).toBe('1 / 6')

      // Simulate navigation to index 3
      await wrapper.setProps({ gridIndex: 3 })
      await wrapper.vm.$nextTick()

      indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.text()).toBe('4 / 6')
    })

    // AC: Indicator is hidden when gridImages has 0 items
    it('does not render indicator when gridImages is empty', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages: [], gridIndex: 0 },
      })
      await flushPromises()

      const indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.exists()).toBe(false)
    })

    // AC: Indicator is hidden when gridImages has exactly 1 item
    it('does not render indicator when gridImages has only 1 item', async () => {
      const gridImages = makeGridImages(1)
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, gridImages, gridIndex: 0 },
      })
      await flushPromises()

      const indicator = wrapper.find('[data-testid="lightbox-grid-indicator"]')
      expect(indicator.exists()).toBe(false)
    })
  })

  // AC: FE: Lightbox X/Y sliders synced to main view X/Y sliders
  describe('lightbox X/Y slider visibility and sync', () => {
    // AC: FE: X slider hidden when no dimension mapped to X axis (lightbox)
    it('does not render X slider bar when xSliderValues is empty', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, xSliderValues: [], xDimensionName: '' },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="lightbox-x-slider-bar"]').exists()).toBe(false)
    })

    // AC: FE: X slider hidden when only one value (not useful for navigation)
    it('does not render X slider bar when xSliderValues has only one value', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, xSliderValues: ['only'], currentXSliderValue: 'only', xDimensionName: 'checkpoint' },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="lightbox-x-slider-bar"]').exists()).toBe(false)
    })

    // AC: FE: X slider visible when dimension mapped to X axis
    it('renders X slider bar when xSliderValues has multiple values', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          ...defaultProps,
          xSliderValues: ['step-1000', 'step-2000'],
          currentXSliderValue: 'step-1000',
          xDimensionName: 'checkpoint',
        },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="lightbox-x-slider-bar"]').exists()).toBe(true)
    })

    // AC: FE: Y slider hidden when no dimension mapped to Y axis (lightbox)
    it('does not render Y slider bar when ySliderValues is empty', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, ySliderValues: [], yDimensionName: '' },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="lightbox-y-slider-bar"]').exists()).toBe(false)
    })

    // AC: FE: Y slider hidden when only one value
    it('does not render Y slider bar when ySliderValues has only one value', async () => {
      const wrapper = mount(ImageLightbox, {
        props: { ...defaultProps, ySliderValues: ['only'], currentYSliderValue: 'only', yDimensionName: 'prompt' },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="lightbox-y-slider-bar"]').exists()).toBe(false)
    })

    // AC: FE: Y slider visible when dimension mapped to Y axis
    it('renders Y slider bar when ySliderValues has multiple values', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          ...defaultProps,
          ySliderValues: ['landscape', 'portrait'],
          currentYSliderValue: 'landscape',
          yDimensionName: 'prompt_name',
        },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="lightbox-y-slider-bar"]').exists()).toBe(true)
    })

    // AC: FE: Lightbox X slider emits x-slider-change when changed
    it('emits x-slider-change when X slider value changes', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          ...defaultProps,
          xSliderValues: ['step-1000', 'step-2000', 'step-3000'],
          currentXSliderValue: 'step-1000',
          xDimensionName: 'checkpoint',
        },
      })
      await flushPromises()

      const xSliderBar = wrapper.find('[data-testid="lightbox-x-slider-bar"]')
      expect(xSliderBar.exists()).toBe(true)

      // The MasterSlider inside emits 'change'; our handler converts to 'x-slider-change'
      const masterSlider = xSliderBar.findComponent({ name: 'MasterSlider' })
      expect(masterSlider.exists()).toBe(true)
      masterSlider.vm.$emit('change', 'step-2000')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('x-slider-change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['step-2000'])
    })

    // AC: FE: Lightbox Y slider emits y-slider-change when changed
    it('emits y-slider-change when Y slider value changes', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          ...defaultProps,
          ySliderValues: ['landscape', 'portrait'],
          currentYSliderValue: 'landscape',
          yDimensionName: 'prompt_name',
        },
      })
      await flushPromises()

      const ySliderBar = wrapper.find('[data-testid="lightbox-y-slider-bar"]')
      expect(ySliderBar.exists()).toBe(true)

      const masterSlider = ySliderBar.findComponent({ name: 'MasterSlider' })
      expect(masterSlider.exists()).toBe(true)
      masterSlider.vm.$emit('change', 'portrait')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('y-slider-change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['portrait'])
    })

    // AC: FE: Both X and Y sliders can be visible simultaneously
    it('renders both X and Y slider bars when both dimensions are mapped', async () => {
      const wrapper = mount(ImageLightbox, {
        props: {
          ...defaultProps,
          xSliderValues: ['step-1000', 'step-2000'],
          currentXSliderValue: 'step-1000',
          xDimensionName: 'checkpoint',
          ySliderValues: ['landscape', 'portrait'],
          currentYSliderValue: 'landscape',
          yDimensionName: 'prompt_name',
        },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="lightbox-x-slider-bar"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="lightbox-y-slider-bar"]').exists()).toBe(true)
    })
  })
})
