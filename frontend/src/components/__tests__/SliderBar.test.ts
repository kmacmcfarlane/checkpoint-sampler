import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSlider } from 'naive-ui'
import SliderBar from '../SliderBar.vue'

const sampleValues = ['100', '500', '1000', '2000']

function mountSlider(overrides: Record<string, unknown> = {}) {
  return mount(SliderBar, {
    props: {
      values: sampleValues,
      currentValue: '500',
      label: 'step',
      ...overrides,
    },
  })
}

describe('SliderBar', () => {
  it('renders a NSlider', () => {
    const wrapper = mountSlider()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.exists()).toBe(true)
  })

  it('sets min to 0 and max to values.length - 1', () => {
    const wrapper = mountSlider()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('min')).toBe(0)
    expect(slider.props('max')).toBe(3)
  })

  it('sets value to the index of currentValue', () => {
    const wrapper = mountSlider({ currentValue: '1000' })
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('value')).toBe(2)
  })

  it('defaults to index 0 when currentValue is not found', () => {
    const wrapper = mountSlider({ currentValue: 'unknown' })
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('value')).toBe(0)
  })

  it('displays the current value as text', () => {
    const wrapper = mountSlider({ currentValue: '1000' })
    expect(wrapper.find('.slider-bar__value').text()).toBe('1000')
  })

  it('emits change with new value on slider update', async () => {
    const wrapper = mountSlider()
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 2)
    await nextTick()

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['1000'])
  })

  it('emits change with first value when set to index 0', async () => {
    const wrapper = mountSlider()
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 0)
    await nextTick()

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual(['100'])
  })

  it('emits change with last value when set to max index', async () => {
    const wrapper = mountSlider()
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 3)
    await nextTick()

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual(['2000'])
  })

  it('has accessible aria-label on container', () => {
    const wrapper = mountSlider({ label: 'checkpoint' })
    const container = wrapper.find('.slider-bar')
    expect(container.attributes('aria-label')).toBe('checkpoint')
  })

  it('has tabindex on container for keyboard focus', () => {
    const wrapper = mountSlider()
    const container = wrapper.find('.slider-bar')
    expect(container.attributes('tabindex')).toBe('0')
  })

  describe('keyboard navigation', () => {
    it('emits change with next value on ArrowRight', async () => {
      const wrapper = mountSlider({ currentValue: '500' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'ArrowRight' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change with previous value on ArrowLeft', async () => {
      const wrapper = mountSlider({ currentValue: '500' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'ArrowLeft' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('emits change with next value on ArrowUp', async () => {
      const wrapper = mountSlider({ currentValue: '500' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'ArrowUp' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change with previous value on ArrowDown', async () => {
      const wrapper = mountSlider({ currentValue: '500' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'ArrowDown' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('does not emit when ArrowRight at last value', async () => {
      const wrapper = mountSlider({ currentValue: '2000' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('does not emit when ArrowLeft at first value', async () => {
      const wrapper = mountSlider({ currentValue: '100' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'ArrowLeft' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('does not emit for non-arrow keys', async () => {
      const wrapper = mountSlider({ currentValue: '500' })
      const container = wrapper.find('.slider-bar')
      await container.trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })
  })
})
