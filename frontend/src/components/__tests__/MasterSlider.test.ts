import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSlider, NButton, NCheckbox, NSelect } from 'naive-ui'
import MasterSlider from '../MasterSlider.vue'
import ImageLightbox from '../ImageLightbox.vue'
import { _resetForTesting } from '../../composables/useSliderKeyboardFocus'

// Mock the api client module (needed by ImageLightbox)
vi.mock('../../api/client', () => ({
  apiClient: {
    getImageMetadata: vi.fn().mockResolvedValue({ metadata: {} }),
  },
}))

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
  // Reset the keyboard focus singleton between tests to prevent cross-test contamination
  beforeEach(() => {
    _resetForTesting()
  })
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

  it('slider is 100% width (no max-width constraint)', () => {
    const wrapper = mountMaster()
    const slider = wrapper.find('.master-slider__slider')
    expect(slider.exists()).toBe(true)
    // Slider should have flex: 1 and no max-width — check it's inside the main row
    const main = wrapper.find('.master-slider__main')
    expect(main.exists()).toBe(true)
    expect(slider.element.closest('.master-slider__main')).toBeTruthy()
  })

  it('play button is inline with the slider in the main row', () => {
    const wrapper = mountMaster()
    const main = wrapper.find('.master-slider__main')
    const buttons = main.findAllComponents(NButton)
    const playBtn = buttons.find((b) => b.text() === 'Play')
    expect(playBtn).toBeDefined()
  })

  describe('keyboard navigation', () => {
    // MasterSlider uses Ctrl+Arrow to avoid conflict with zoom controls (plain arrows)
    it('emits change with next value on Ctrl+ArrowRight', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowRight', ctrlKey: true })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change with previous value on Ctrl+ArrowLeft', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowLeft', ctrlKey: true })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('emits change with next value on Ctrl+ArrowUp', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowUp', ctrlKey: true })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change with previous value on Ctrl+ArrowDown', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowDown', ctrlKey: true })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('does not emit on plain ArrowRight (no Ctrl) — avoids conflict with zoom controls', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('does not emit on plain ArrowLeft (no Ctrl) — avoids conflict with zoom controls', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowLeft' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('wraps forward: Ctrl+ArrowRight at last value emits first value', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowRight', ctrlKey: true })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('wraps backward: Ctrl+ArrowLeft at first value emits last value', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'ArrowLeft', ctrlKey: true })

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['2000'])
    })

    it('does not emit for non-arrow keys', async () => {
      const wrapper = mountMaster({ currentValue: '500' })
      const container = wrapper.find('.master-slider')
      await container.trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('NSlider has keyboard=false to prevent built-in arrow key conflict', () => {
      const wrapper = mountMaster()
      const slider = wrapper.findComponent(NSlider)
      expect(slider.props('keyboard')).toBe(false)
    })
  })

  describe('document-level keyboard navigation', () => {
    let wrapper: ReturnType<typeof mountMaster> | null = null

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount()
        wrapper = null
      }
    })

    it('emits change on Ctrl+ArrowRight via document keydown when wrapper is not focused', async () => {
      wrapper = mountMaster({ currentValue: '500' })

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    it('emits change on Ctrl+ArrowLeft via document keydown when wrapper is not focused', async () => {
      wrapper = mountMaster({ currentValue: '500' })

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['100'])
    })

    it('does not emit on plain ArrowRight via document (no Ctrl — avoids zoom control conflict)', async () => {
      wrapper = mountMaster({ currentValue: '500' })

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      expect(wrapper.emitted('change')).toBeUndefined()
    })

    it('does not emit when an input element is focused', async () => {
      wrapper = mountMaster({ currentValue: '500' })

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      expect(wrapper.emitted('change')).toBeUndefined()

      input.remove()
    })

    it('does not emit when a textarea is focused', async () => {
      wrapper = mountMaster({ currentValue: '500' })

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      expect(wrapper.emitted('change')).toBeUndefined()

      textarea.remove()
    })

    it('removes document listener on unmount', async () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      wrapper = mountMaster({ currentValue: '500' })

      wrapper.unmount()
      wrapper = null  // afterEach should not double-unmount

      const removed = removeSpy.mock.calls.some((c) => c[0] === 'keydown')
      expect(removed).toBe(true)

      removeSpy.mockRestore()
    })

    it('plain arrow keys are handled by ImageLightbox slider; MasterSlider requires Ctrl+Arrow', async () => {
      // Mount MasterSlider
      wrapper = mountMaster({ currentValue: '500' })

      // Mount ImageLightbox with a slider so its arrow key handler fires
      const lightboxWrapper = mount(ImageLightbox, {
        props: {
          imageUrl: '/api/images/dir/image.png',
          cellKey: 'x|y',
          sliderValues: ['3', '7', '15'],
          currentSliderValue: '7',
          imagesBySliderValue: {
            '3': '/api/images/dir/a.png',
            '7': '/api/images/dir/b.png',
            '15': '/api/images/dir/c.png',
          },
          sliderDimensionName: 'cfg',
          gridImages: [],
          gridIndex: 0,
        },
      })

      // Plain ArrowRight (no Ctrl): ImageLightbox handles it via stopImmediatePropagation,
      // and MasterSlider also ignores it because it requires Ctrl+Arrow.
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      // Lightbox should have emitted slider-change (it handles plain arrows)
      expect(lightboxWrapper.emitted('slider-change')).toBeDefined()

      // MasterSlider should NOT have emitted change (requires Ctrl+Arrow, not plain arrow)
      expect(wrapper.emitted('change')).toBeUndefined()

      lightboxWrapper.unmount()
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
      const wrapper = mountMaster({ currentValue: '100' })
      // Start playing to reveal loop controls
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      // Disable loop (on by default)
      const loopCheckbox = wrapper.findComponent(NCheckbox)
      loopCheckbox.vm.$emit('update:checked', false)
      await nextTick()

      // Stop and restart at last value
      const pauseBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Pause')!
      await pauseBtn.trigger('click')
      await wrapper.setProps({ currentValue: '2000' })

      const playBtn2 = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn2.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      // Should have stopped — no change emitted after last value with loop off
      const currentBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      expect(currentBtn.text()).toBe('Play')
    })

    it('wraps to first value when loop is on (default)', async () => {
      const wrapper = mountMaster({ currentValue: '2000' })
      // Loop is on by default, no need to enable it
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

    it('renders speed selector with default 1s when playing', async () => {
      const wrapper = mountMaster()
      // Speed selector only visible when playing
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')
      expect(speedSelect).toBeDefined()
      expect(speedSelect!.props('value')).toBe(1000)
    })

    it('has 6 speed options including 0.25s and 0.33s', async () => {
      const wrapper = mountMaster()
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')!
      const options = speedSelect.props('options') as Array<{ label: string; value: number }>
      expect(options).toHaveLength(6)
      expect(options.map((o) => o.label)).toEqual(['0.25s', '0.33s', '0.5s', '1s', '2s', '3s'])
      expect(options.map((o) => o.value)).toEqual([250, 330, 500, 1000, 2000, 3000])
    })

    it('adjusts playback interval when speed changes', async () => {
      const wrapper = mountMaster({ currentValue: '100' })
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      // Change speed to 500ms
      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')!
      speedSelect.vm.$emit('update:value', 500)
      await nextTick()

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

    it('loop checkbox is checked by default', async () => {
      const wrapper = mountMaster()
      // Start playing to reveal loop controls
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      const checkbox = wrapper.findComponent(NCheckbox)
      expect(checkbox.exists()).toBe(true)
      expect(checkbox.props('checked')).toBe(true)
    })

    it('has accessible labels on playback controls when playing', async () => {
      const wrapper = mountMaster()
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      expect(playBtn.attributes('aria-label')).toBe('Play playback')

      // Start playing to check loop/speed labels
      await playBtn.trigger('click')

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

    it('hides loop controls when not playing', () => {
      const wrapper = mountMaster()
      expect(wrapper.find('.master-slider__loop-controls').exists()).toBe(false)
      // Checkbox and speed selector should not be visible
      expect(wrapper.findComponent(NCheckbox).exists()).toBe(false)
      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')
      expect(speedSelect).toBeUndefined()
    })

    it('shows loop controls when playing', async () => {
      const wrapper = mountMaster()
      const playBtn = wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play')!
      await playBtn.trigger('click')

      expect(wrapper.find('.master-slider__loop-controls').exists()).toBe(true)
      expect(wrapper.findComponent(NCheckbox).exists()).toBe(true)
      const speedSelect = wrapper.findAllComponents(NSelect).find((s) => s.attributes('aria-label') === 'Playback speed')
      expect(speedSelect).toBeDefined()
    })

    it('hides loop controls after stopping playback', async () => {
      const wrapper = mountMaster()
      const getPlayPauseBtn = () => wrapper.findAllComponents(NButton).find((b) => b.text() === 'Play' || b.text() === 'Pause')!
      await getPlayPauseBtn().trigger('click') // play
      expect(wrapper.find('.master-slider__loop-controls').exists()).toBe(true)

      await getPlayPauseBtn().trigger('click') // pause
      expect(wrapper.find('.master-slider__loop-controls').exists()).toBe(false)
    })
  })

  // AC1, AC3, AC4: Multiple MasterSlider instances — only one captures keyboard input
  describe('multiple instance keyboard conflict guard', () => {
    let wrapper1: ReturnType<typeof mountMaster> | null = null
    let wrapper2: ReturnType<typeof mountMaster> | null = null

    afterEach(() => {
      if (wrapper2) { wrapper2.unmount(); wrapper2 = null }
      if (wrapper1) { wrapper1.unmount(); wrapper1 = null }
    })

    // AC1: Only one captures keyboard input
    it('only the last-mounted slider handles document-level Ctrl+Arrow keys', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      // AC3: No duplicate key handling — wrapper1 (non-active) should NOT emit
      expect(wrapper1.emitted('change')).toBeUndefined()

      // wrapper2 (active, last mounted) should emit
      const emitted = wrapper2.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['500'])
    })

    // AC2: Priority system — clicking a slider claims focus
    it('clicking a non-active slider transfers keyboard focus to it', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      // Click on wrapper1 to claim focus
      await wrapper1.find('.master-slider').trigger('click')

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      // wrapper1 should now be the active handler
      const emitted1 = wrapper1.emitted('change')
      expect(emitted1).toBeDefined()
      expect(emitted1).toHaveLength(1)
      expect(emitted1![0]).toEqual(['1000'])

      // wrapper2 should NOT emit
      expect(wrapper2.emitted('change')).toBeUndefined()
    })

    // AC2: Focus can switch back and forth
    it('focus transfers between instances via click', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      // Click wrapper1 to claim focus
      await wrapper1.find('.master-slider').trigger('click')

      // Click wrapper2 to claim focus back
      await wrapper2.find('.master-slider').trigger('click')

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      // wrapper2 is now active again
      expect(wrapper1.emitted('change')).toBeUndefined()
      const emitted2 = wrapper2.emitted('change')
      expect(emitted2).toBeDefined()
      expect(emitted2).toHaveLength(1)
    })

    // AC1: When the active slider is unmounted, the remaining one becomes active
    it('when the active slider unmounts, the remaining slider becomes active', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      // wrapper2 is active (last mounted). Unmount it.
      wrapper2.unmount()
      wrapper2 = null

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      // wrapper1 should now be the active handler
      const emitted = wrapper1.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })

    // AC3: No duplicate key handling — verify exactly one emission total
    it('document Ctrl+Arrow key fires exactly one change event across all instances', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      const emissions1 = wrapper1.emitted('change') ?? []
      const emissions2 = wrapper2.emitted('change') ?? []
      const totalEmissions = emissions1.length + emissions2.length

      // AC3: Exactly one slider should have handled the event
      expect(totalEmissions).toBe(1)
    })

    // AC2: Focus claim via the focus event (tabbing to a slider)
    it('focusing a slider via tab (focus event) claims keyboard ownership', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      // Simulate focusing wrapper1 (e.g. via tab key)
      await wrapper1.find('.master-slider').trigger('focus')

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      await nextTick()

      // wrapper1 is active after focus event
      const emitted = wrapper1.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)

      // wrapper2 did not emit
      expect(wrapper2.emitted('change')).toBeUndefined()
    })

    // Verify direct Ctrl+keydown on the focused slider element still works regardless of singleton
    it('direct Ctrl+Arrow keydown on the slider element bypasses the singleton guard', async () => {
      wrapper1 = mountMaster({ currentValue: '500', dimensionName: 'step' })
      wrapper2 = mountMaster({ currentValue: '100', dimensionName: 'cfg' })

      // wrapper2 is active. Directly trigger Ctrl+ArrowRight on wrapper1's container element.
      // The @keydown handler on the div fires without the singleton check.
      const container1 = wrapper1.find('.master-slider')
      await container1.trigger('keydown', { key: 'ArrowRight', ctrlKey: true })

      // This is the direct keydown handler (onKeydown), not onDocumentKeydown.
      // It should still emit because direct interaction is always allowed.
      const emitted = wrapper1.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['1000'])
    })
  })
})
