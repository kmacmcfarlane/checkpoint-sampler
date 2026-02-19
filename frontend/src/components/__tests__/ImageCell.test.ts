import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageCell from '../ImageCell.vue'

describe('ImageCell', () => {
  it('renders an image when relativePath is provided', () => {
    const wrapper = mount(ImageCell, {
      props: { relativePath: 'dir/index=0&seed=42.png' },
    })

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/api/images/dir/index=0&seed=42.png')
    expect(img.attributes('alt')).toBe('dir/index=0&seed=42.png')
  })

  it('renders placeholder when relativePath is null', () => {
    const wrapper = mount(ImageCell, {
      props: { relativePath: null },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.image-cell__placeholder').exists()).toBe(true)
    expect(wrapper.find('.image-cell__placeholder').text()).toBe('No image')
  })

  it('applies empty class when no image', () => {
    const wrapper = mount(ImageCell, {
      props: { relativePath: null },
    })

    expect(wrapper.find('.image-cell--empty').exists()).toBe(true)
  })

  it('does not apply empty class when image exists', () => {
    const wrapper = mount(ImageCell, {
      props: { relativePath: 'path/to/image.png' },
    })

    expect(wrapper.find('.image-cell--empty').exists()).toBe(false)
  })

  it('sets lazy loading on images', () => {
    const wrapper = mount(ImageCell, {
      props: { relativePath: 'path/to/image.png' },
    })

    expect(wrapper.find('img').attributes('loading')).toBe('lazy')
  })
})
