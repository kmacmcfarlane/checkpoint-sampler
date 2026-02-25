import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageCell from '../ImageCell.vue'

const sampleValues = ['100', '500', '1000', '2000']

function mountCell(overrides: Record<string, unknown> = {}) {
  return mount(ImageCell, {
    props: {
      relativePath: 'dir/index=0&seed=42.png',
      ...overrides,
    },
  })
}

describe('ImageCell', () => {
  it('renders an image when relativePath is provided', () => {
    const wrapper = mountCell({ relativePath: 'dir/index=0&seed=42.png' })

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/api/images/dir/index=0&seed=42.png')
    expect(img.attributes('alt')).toBe('dir/index=0&seed=42.png')
  })

  it('renders placeholder when relativePath is null', () => {
    const wrapper = mountCell({ relativePath: null })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.image-cell__placeholder').exists()).toBe(true)
    expect(wrapper.find('.image-cell__placeholder').text()).toBe('No image')
  })

  it('applies empty class when no image', () => {
    const wrapper = mountCell({ relativePath: null })

    expect(wrapper.find('.image-cell--empty').exists()).toBe(true)
  })

  it('does not apply empty class when image exists', () => {
    const wrapper = mountCell({ relativePath: 'path/to/image.png' })

    expect(wrapper.find('.image-cell--empty').exists()).toBe(false)
  })

  it('sets lazy loading on images', () => {
    const wrapper = mountCell({ relativePath: 'path/to/image.png' })

    expect(wrapper.find('img').attributes('loading')).toBe('lazy')
  })

  describe('keyboard navigation', () => {
    it('has tabindex when sliderValues are provided', () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      expect(wrapper.find('.image-cell').attributes('tabindex')).toBe('0')
    })

    it('does not have tabindex when no sliderValues', () => {
      const wrapper = mountCell({ relativePath: 'path/to/image.png' })
      expect(wrapper.find('.image-cell').attributes('tabindex')).toBeUndefined()
    })

    it('emits slider:change with next value on ArrowRight', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowRight' })

      const emitted = wrapper.emitted('slider:change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits slider:change with previous value on ArrowLeft', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowLeft' })

      const emitted = wrapper.emitted('slider:change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('emits slider:change with next value on ArrowUp', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowUp' })

      const emitted = wrapper.emitted('slider:change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits slider:change with previous value on ArrowDown', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowDown' })

      const emitted = wrapper.emitted('slider:change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('wraps forward: ArrowRight at last value emits first value', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '2000',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowRight' })

      const emitted = wrapper.emitted('slider:change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['100'])
    })

    it('wraps backward: ArrowLeft at first value emits last value', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '100',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowLeft' })

      const emitted = wrapper.emitted('slider:change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['2000'])
    })

    it('does not emit for non-arrow keys', async () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('slider:change')).toBeUndefined()
    })

    it('does not emit when no sliderValues provided', async () => {
      const wrapper = mountCell({ relativePath: 'path/to/image.png' })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('slider:change')).toBeUndefined()
    })

    it('does not emit when sliderValues is empty', async () => {
      const wrapper = mountCell({
        sliderValues: [],
        currentSliderValue: '',
      })
      await wrapper.find('.image-cell').trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('slider:change')).toBeUndefined()
    })
  })

  describe('visual focus indicator', () => {
    it('has focus-visible outline style via CSS class', () => {
      const wrapper = mountCell({
        sliderValues: sampleValues,
        currentSliderValue: '500',
      })
      // The :focus CSS is applied via the stylesheet; verify the element is focusable
      const cell = wrapper.find('.image-cell')
      expect(cell.attributes('tabindex')).toBe('0')
    })
  })
})
