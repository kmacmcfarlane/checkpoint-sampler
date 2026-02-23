import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSlider } from 'naive-ui'
import ZoomControl from '../ZoomControl.vue'

function mountZoom(overrides: Record<string, unknown> = {}) {
  return mount(ZoomControl, {
    props: {
      cellSize: 200,
      ...overrides,
    },
  })
}

describe('ZoomControl', () => {
  it('renders a NSlider', () => {
    const wrapper = mountZoom()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.exists()).toBe(true)
  })

  it('displays "Zoom" as label', () => {
    const wrapper = mountZoom()
    expect(wrapper.find('.zoom-control__label').text()).toBe('Zoom')
  })

  it('sets min to 100 and max to 600', () => {
    const wrapper = mountZoom()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('min')).toBe(100)
    expect(slider.props('max')).toBe(600)
  })

  it('sets step to 10', () => {
    const wrapper = mountZoom()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('step')).toBe(10)
  })

  it('sets value to the current cell size', () => {
    const wrapper = mountZoom({ cellSize: 300 })
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('value')).toBe(300)
  })

  it('displays the current cell size with px suffix', () => {
    const wrapper = mountZoom({ cellSize: 350 })
    expect(wrapper.find('.zoom-control__value').text()).toBe('350px')
  })

  it('emits update:cellSize with new value on slider update', async () => {
    const wrapper = mountZoom({ cellSize: 200 })
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 400)
    await nextTick()

    const emitted = wrapper.emitted('update:cellSize')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual([400])
  })

  it('emits update:cellSize with minimum value (100)', async () => {
    const wrapper = mountZoom({ cellSize: 200 })
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 100)
    await nextTick()

    const emitted = wrapper.emitted('update:cellSize')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual([100])
  })

  it('emits update:cellSize with maximum value (600)', async () => {
    const wrapper = mountZoom({ cellSize: 200 })
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 600)
    await nextTick()

    const emitted = wrapper.emitted('update:cellSize')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual([600])
  })

  it('has role="group" with accessible label on container', () => {
    const wrapper = mountZoom()
    const group = wrapper.find('[role="group"]')
    expect(group.exists()).toBe(true)
    expect(group.attributes('aria-label')).toBe('Grid cell zoom control')
  })

  it('slider has aria-label', () => {
    const wrapper = mountZoom()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.attributes('aria-label')).toBe('Grid cell zoom')
  })

  it('slider is 100% width (flex: 1)', () => {
    const wrapper = mountZoom()
    const slider = wrapper.find('.zoom-control__slider')
    expect(slider.exists()).toBe(true)
    // Slider should have flex: 1 and be inside the main container
    const container = wrapper.find('.zoom-control')
    expect(container.exists()).toBe(true)
    expect(slider.element.closest('.zoom-control')).toBeTruthy()
  })

  describe('cell size range validation', () => {
    it.each([
      { input: 100, expected: 100, description: 'minimum size (100px)' },
      { input: 150, expected: 150, description: 'small thumbnail size (150px)' },
      { input: 200, expected: 200, description: 'default size (200px)' },
      { input: 300, expected: 300, description: 'medium size (300px)' },
      { input: 450, expected: 450, description: 'large size (450px)' },
      { input: 600, expected: 600, description: 'maximum size (600px)' },
    ])('accepts $description', async ({ input, expected }) => {
      const wrapper = mountZoom({ cellSize: input })
      const slider = wrapper.findComponent(NSlider)
      expect(slider.props('value')).toBe(expected)
      expect(wrapper.find('.zoom-control__value').text()).toBe(`${expected}px`)
    })
  })

  describe('proportional sizing', () => {
    it('updates single cell size value (width and height controlled together)', async () => {
      const wrapper = mountZoom({ cellSize: 200 })
      const slider = wrapper.findComponent(NSlider)

      // Update to a larger size
      slider.vm.$emit('update:value', 400)
      await nextTick()

      const emitted = wrapper.emitted('update:cellSize')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual([400])

      // The parent component (XYGrid) will apply this to both cellWidth and cellHeight
    })
  })
})
