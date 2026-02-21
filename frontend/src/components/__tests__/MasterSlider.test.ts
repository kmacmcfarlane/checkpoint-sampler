import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import MasterSlider from '../MasterSlider.vue'

const sampleValues = ['100', '500', '1000', '2000']

function mountMaster(overrides: Record<string, unknown> = {}) {
  return mount(MasterSlider, {
    props: {
      values: sampleValues,
      currentValue: '500',
      dimensionName: 'step',
      ...overrides,
    },
  })
}

describe('MasterSlider', () => {
  it('renders a range input', () => {
    const wrapper = mountMaster()
    const input = wrapper.find('input[type="range"]')
    expect(input.exists()).toBe(true)
  })

  it('displays the dimension name as label', () => {
    const wrapper = mountMaster({ dimensionName: 'checkpoint' })
    expect(wrapper.find('.master-slider__label').text()).toBe('checkpoint')
  })

  it('sets min to 0 and max to values.length - 1', () => {
    const wrapper = mountMaster()
    const input = wrapper.find('input[type="range"]')
    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBe('3')
  })

  it('sets value to the index of currentValue', () => {
    const wrapper = mountMaster({ currentValue: '1000' })
    const input = wrapper.find('input[type="range"]')
    expect((input.element as HTMLInputElement).value).toBe('2')
  })

  it('defaults to index 0 when currentValue is not found', () => {
    const wrapper = mountMaster({ currentValue: 'unknown' })
    const input = wrapper.find('input[type="range"]')
    expect((input.element as HTMLInputElement).value).toBe('0')
  })

  it('displays the current value as text', () => {
    const wrapper = mountMaster({ currentValue: '1000' })
    expect(wrapper.find('.master-slider__value').text()).toBe('1000')
  })

  it('emits change with new value on input', async () => {
    const wrapper = mountMaster()
    const input = wrapper.find('input[type="range"]')
    await input.setValue('2')

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['1000'])
  })

  it('emits change with first value when set to index 0', async () => {
    const wrapper = mountMaster()
    const input = wrapper.find('input[type="range"]')
    await input.setValue('0')

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual(['100'])
  })

  it('has accessible aria-label with dimension name', () => {
    const wrapper = mountMaster({ dimensionName: 'checkpoint' })
    const input = wrapper.find('input[type="range"]')
    expect(input.attributes('aria-label')).toBe('Master checkpoint')
  })

  it('has aria-valuetext showing current value', () => {
    const wrapper = mountMaster({ currentValue: '1000' })
    const input = wrapper.find('input[type="range"]')
    expect(input.attributes('aria-valuetext')).toBe('1000')
  })

  it('has role="group" with accessible label on container', () => {
    const wrapper = mountMaster({ dimensionName: 'step' })
    const group = wrapper.find('[role="group"]')
    expect(group.exists()).toBe(true)
    expect(group.attributes('aria-label')).toBe('Master step slider')
  })

  it('has tabindex on container for keyboard focus', () => {
    const wrapper = mountMaster()
    const container = wrapper.find('.master-slider')
    expect(container.attributes('tabindex')).toBe('0')
  })

  describe('keyboard navigation', () => {
    it('emits change with next value on ArrowRight', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowRight' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change with previous value on ArrowLeft', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowLeft' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('emits change with next value on ArrowUp', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowUp' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change with previous value on ArrowDown', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowDown' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('does not emit when ArrowRight at last value', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('does not emit when ArrowLeft at first value', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowLeft' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('does not emit for non-arrow keys', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('handles keyboard on the range input directly', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const input = wrapper.find('input[type="range"]')
      await input.trigger('keydown', { key: 'ArrowRight' })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['1000'])
    })
  })

  describe('playback', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('renders play button', () => {
      const wrapper = mountMaster()
      const btn = wrapper.find('.master-slider__play-btn')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toBe('Play')
    })

    it('shows Pause when playing', async () => {
      const wrapper = mountMaster()
      await wrapper.find('.master-slider__play-btn').trigger('click')
      expect(wrapper.find('.master-slider__play-btn').text()).toBe('Pause')
    })

    it('shows Play when paused after playing', async () => {
      const wrapper = mountMaster()
      const btn = wrapper.find('.master-slider__play-btn')
      await btn.trigger('click') // play
      await btn.trigger('click') // pause
      expect(btn.text()).toBe('Play')
    })

    it('emits change to next value on interval tick', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      await wrapper.find('.master-slider__play-btn').trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('advances through multiple values over multiple ticks', async () => {
      // Start at index 0, advance twice
      const wrapper = mountMaster({ currentValue: '100' })
      await wrapper.find('.master-slider__play-btn').trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()
      // First advance emits '500'
      let emitted = wrapper.emitted('change')!
      expect(emitted[0]).toEqual(['500'])

      // Update the prop to reflect the advance
      await wrapper.setProps({ currentValue: '500' })
      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      emitted = wrapper.emitted('change')!
      expect(emitted[1]).toEqual(['1000'])
    })

    it('stops at last value when loop is off', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      await wrapper.find('.master-slider__play-btn').trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      // Should not emit any change (already at last)
      expect(wrapper.emitted('change')).toBeUndefined()
      // Should stop playing
      expect(wrapper.find('.master-slider__play-btn').text()).toBe('Play')
    })

    it('wraps to first value when loop is on and at last', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      // Enable loop
      const loopCheckbox = wrapper.find('input[type="checkbox"]')
      await loopCheckbox.setValue(true)

      await wrapper.find('.master-slider__play-btn').trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['100'])
      // Should still be playing
      expect(wrapper.find('.master-slider__play-btn').text()).toBe('Pause')
    })

    it('does not start playback with 0 or 1 values', async () => {
      const wrapper = mountMaster({ values: ['only'], currentValue: 'only' })
      await wrapper.find('.master-slider__play-btn').trigger('click')
      expect(wrapper.find('.master-slider__play-btn').text()).toBe('Play')
    })

    it('stops emitting after pause is clicked', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const btn = wrapper.find('.master-slider__play-btn')
      await btn.trigger('click') // play
      await btn.trigger('click') // pause

      vi.advanceTimersByTime(2000)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('renders speed selector with default 1s', () => {
      const wrapper = mountMaster()
      const select = wrapper.find('.master-slider__speed')
      expect(select.exists()).toBe(true)
      expect((select.element as HTMLSelectElement).value).toBe('1000')
    })

    it('adjusts playback interval when speed changes', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      // Change speed to 500ms
      const select = wrapper.find('.master-slider__speed')
      await select.setValue('500')

      await wrapper.find('.master-slider__play-btn').trigger('click')

      // After 500ms, should advance
      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('restarts interval when speed changes during playback', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      await wrapper.find('.master-slider__play-btn').trigger('click')

      // Advance 800ms (not enough for 1000ms interval)
      vi.advanceTimersByTime(800)
      expect(wrapper.emitted('change')).toBeUndefined()

      // Change speed to 500ms — restarts interval
      const select = wrapper.find('.master-slider__speed')
      await select.setValue('500')

      // After 500ms from the speed change, should advance
      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('renders loop checkbox unchecked by default', () => {
      const wrapper = mountMaster()
      const checkbox = wrapper.find('input[type="checkbox"]')
      expect(checkbox.exists()).toBe(true)
      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    })

    it('has accessible labels on playback controls', () => {
      const wrapper = mountMaster()
      const playBtn = wrapper.find('.master-slider__play-btn')
      expect(playBtn.attributes('aria-label')).toBe('Play playback')

      const checkbox = wrapper.find('input[type="checkbox"]')
      expect(checkbox.attributes('aria-label')).toBe('Loop playback')

      const select = wrapper.find('.master-slider__speed')
      expect(select.attributes('aria-label')).toBe('Playback speed')
    })

    it('play button has aria-label Pause when playing', async () => {
      const wrapper = mountMaster()
      await wrapper.find('.master-slider__play-btn').trigger('click')
      expect(wrapper.find('.master-slider__play-btn').attributes('aria-label')).toBe('Pause playback')
    })

    it('stops playback when values prop changes', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      await wrapper.find('.master-slider__play-btn').trigger('click')
      expect(wrapper.find('.master-slider__play-btn').text()).toBe('Pause')

      await wrapper.setProps({ values: ['a', 'b', 'c'] })
      expect(wrapper.find('.master-slider__play-btn').text()).toBe('Play')
    })
  })
})
