import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSlider, NButton, NCheckbox, NSelect } from 'naive-ui'
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
  it('renders a NSlider', () => {
    const wrapper = mountMaster()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.exists()).toBe(true)
  })

  it('displays the dimension name as label', () => {
    const wrapper = mountMaster({ dimensionName: 'checkpoint' })
    expect(wrapper.find('.master-slider__label').text()).toBe('checkpoint')
  })

  it('sets min to 0 and max to values.length - 1', () => {
    const wrapper = mountMaster()
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('min')).toBe(0)
    expect(slider.props('max')).toBe(3)
  })

  it('sets value to the index of currentValue', () => {
    const wrapper = mountMaster({ currentValue: '1000' })
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('value')).toBe(2)
  })

  it('defaults to index 0 when currentValue is not found', () => {
    const wrapper = mountMaster({ currentValue: 'unknown' })
    const slider = wrapper.findComponent(NSlider)
    expect(slider.props('value')).toBe(0)
  })

  it('displays the current value as text', () => {
    const wrapper = mountMaster({ currentValue: '1000' })
    expect(wrapper.find('.master-slider__value').text()).toBe('1000')
  })

  it('emits change with new value on slider update', async () => {
    const wrapper = mountMaster()
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 2)
    await nextTick()

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['1000'])
  })

  it('emits change with first value when set to index 0', async () => {
    const wrapper = mountMaster()
    const slider = wrapper.findComponent(NSlider)
    slider.vm.$emit('update:value', 0)
    await nextTick()

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeDefined()
    expect(emitted![0]).toEqual(['100'])
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
      const buttons = wrapper.findAllComponents(NButton)
      const playBtn = buttons.find((b) => b.text() === 'Play')
      expect(playBtn).toBeDefined()
    })

    it('shows Pause when playing', async () => {
      const wrapper = mountMaster()
      const buttons = wrapper.findAllComponents(NButton)
      const playBtn = buttons.find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')
      const pauseBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Pause')
      expect(pauseBtn).toBeDefined()
    })

    it('shows Play when paused after playing', async () => {
      const wrapper = mountMaster()
      const getPlayBtn = () => wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      await getPlayBtn().trigger('click') // play
      await getPlayBtn().trigger('click') // pause
      expect(getPlayBtn().text()).toBe('Play')
    })

    it('emits change to next value on interval tick', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('advances through multiple values over multiple ticks', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()
      let emitted = wrapper.emitted('change')!
      expect(emitted[0]).toEqual(['500'])

      await wrapper.setProps({ currentValue: '500' })
      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      emitted = wrapper.emitted('change')!
      expect(emitted[1]).toEqual(['1000'])
    })

    it('stops at last value when loop is off', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('change')).toBeUndefined()
      const currentBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      expect(currentBtn.text()).toBe('Play')
    })

    it('wraps to first value when loop is on and at last', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      // Enable loop
      const loopCheckbox = wrapper.findComponent(NCheckbox)
      loopCheckbox.vm.$emit('update:checked', true)
      await nextTick()

      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['100'])
      const currentBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      expect(currentBtn.text()).toBe('Pause')
    })

    it('does not start playback with 0 or 1 values', async () => {
      const wrapper = mountMaster({ values: ['only'], currentValue: 'only' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')
      const currentBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      expect(currentBtn.text()).toBe('Play')
    })

    it('stops emitting after pause is clicked', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const getPlayPauseBtn = () => wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      await getPlayPauseBtn().trigger('click') // play
      await getPlayPauseBtn().trigger('click') // pause

      vi.advanceTimersByTime(2000)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('renders speed selector with default 1s', () => {
      const wrapper = mountMaster()
      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')
      expect(speedSelect).toBeDefined()
      expect(speedSelect!.props('value')).toBe(1000)
    })

    it('adjusts playback interval when speed changes', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      // Change speed to 500ms
      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')!
      speedSelect.vm.$emit('update:value', 500)
      await nextTick()

      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('restarts interval when speed changes during playback', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      vi.advanceTimersByTime(800)
      expect(wrapper.emitted('change')).toBeUndefined()

      // Change speed to 500ms — restarts interval
      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')!
      speedSelect.vm.$emit('update:value', 500)
      await nextTick()

      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('renders loop checkbox unchecked by default', () => {
      const wrapper = mountMaster()
      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.exists()).toBe(true)
      expect(checkbox.props('checked')).toBe(false)
    })

    it('has accessible labels on playback controls', () => {
      const wrapper = mountMaster()
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      expect(playBtn.attributes('aria-label')).toBe('Play playback')

      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.attributes('aria-label')).toBe('Loop playback')

      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')
      expect(speedSelect).toBeDefined()
    })

    it('play button has aria-label Pause when playing', async () => {
      const wrapper = mountMaster()
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')
      const pauseBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Pause')!
      expect(pauseBtn.attributes('aria-label')).toBe('Pause playback')
    })

    it('stops playback when values prop changes', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')
      const pauseBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Pause')
      expect(pauseBtn).toBeDefined()

      await wrapper.setProps({ values: ['a', 'b', 'c'] })
      const currentBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      expect(currentBtn.text()).toBe('Play')
    })
  })
})
