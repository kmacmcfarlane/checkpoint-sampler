import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
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
  it('renders a range input', () => {
    const wrapper = mountSlider()
    const input = wrapper.find('input[type="range"]')
    expect(input.exists()).toBe(true)
  })

  it('sets min to 0 and max to values.length - 1', () => {
    const wrapper = mountSlider()
    const input = wrapper.find('input[type="range"]')
    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBe('3')
  })

  it('sets value to the index of currentValue', () => {
    const wrapper = mountSlider({ currentValue: '1000' })
    const input = wrapper.find('input[type="range"]')
    expect((input.element as HTMLInputElement).value).toBe('2')
  })

  it('defaults to index 0 when currentValue is not found', () => {
    const wrapper = mountSlider({ currentValue: 'unknown' })
    const input = wrapper.find('input[type="range"]')
    expect((input.element as HTMLInputElement).value).toBe('0')
  })

  it('displays the current value as text', () => {
    const wrapper = mountSlider({ currentValue: '1000' })
    expect(wrapper.find('.slider-bar__value').text()).toBe('1000')
  })

  it('emits change with new value on input', async () => {
    const wrapper = mountSlider()
    const input = wrapper.find('input[type="range"]')
    await input.setValue('2')

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['1000'])
  })

  it('emits change with first value when set to index 0', async () => {
    const wrapper = mountSlider()
    const input = wrapper.find('input[type="range"]')
    await input.setValue('0')

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual(['100'])
  })

  it('emits change with last value when set to max index', async () => {
    const wrapper = mountSlider()
    const input = wrapper.find('input[type="range"]')
    await input.setValue('3')

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual(['2000'])
  })

  it('has accessible aria-label', () => {
    const wrapper = mountSlider({ label: 'checkpoint' })
    const input = wrapper.find('input[type="range"]')
    expect(input.attributes('aria-label')).toBe('checkpoint')
  })

  it('has aria-valuetext showing current value', () => {
    const wrapper = mountSlider({ currentValue: '1000' })
    const input = wrapper.find('input[type="range"]')
    expect(input.attributes('aria-valuetext')).toBe('1000')
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

    it('handles keyboard on the range input directly', async () => {
      const wrapper = mountSlider({ currentValue: '500' })
      const input = wrapper.find('input[type="range"]')
      await input.trigger('keydown', { key: 'ArrowRight' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['1000'])
    })
  })
})
