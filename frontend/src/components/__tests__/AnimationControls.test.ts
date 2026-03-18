import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NButton, NCheckbox, NSelect } from 'naive-ui'
import AnimationControls from '../AnimationControls.vue'

// enableAutoUnmount is configured globally in vitest.setup.ts

const sampleValues = ['100', '500', '1000', '2000']

function mountControls(overrides: Record<string, unknown> = {}) {
  return mount(AnimationControls, {
    props: {
      values: sampleValues,
      currentValue: '500',
      dimensionName: 'step',
      ...overrides,
    },
  })
}

describe('AnimationControls', () => {
  // AC: FE: Animation controls positioned at top where master slider was
  it('renders with correct role and aria-label', () => {
    const wrapper = mountControls()
    const group = wrapper.find('[role="group"]')
    expect(group.exists()).toBe(true)
    expect(group.attributes('aria-label')).toBe('Animation controls for step')
  })

  it('displays the dimension name as label', () => {
    const wrapper = mountControls({ dimensionName: 'checkpoint' })
    expect(wrapper.find('.animation-controls__label').text()).toBe('checkpoint')
  })

  it('displays the current value', () => {
    const wrapper = mountControls({ currentValue: '1000' })
    expect(wrapper.find('.animation-controls__value').text()).toBe('1000')
  })

  it('has data-testid for E2E targeting', () => {
    const wrapper = mountControls()
    expect(wrapper.find('[data-testid="animation-controls"]').exists()).toBe(true)
  })

  // AC: FE: No slider track in animation controls (just play/loop/speed)
  it('does NOT render an NSlider (no slider track)', () => {
    const wrapper = mountControls()
    // AnimationControls should have no slider element
    expect(wrapper.find('.n-slider').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('role="slider"')
  })

  it('renders play button', () => {
    const wrapper = mountControls()
    const playBtn = wrapper.find('[data-testid="play-pause-button"]')
    expect(playBtn.exists()).toBe(true)
    expect(playBtn.attributes('aria-label')).toBe('Play playback')
  })

  describe('playback', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows Pause aria-label when playing', async () => {
      const wrapper = mountControls()
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')
      expect(playBtn.attributes('aria-label')).toBe('Pause playback')
    })

    it('emits change to next value on interval tick', async () => {
      const wrapper = mountControls({ currentValue: '100' })
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('wraps to first value when loop is on (default)', async () => {
      const wrapper = mountControls({ currentValue: '2000' })
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['100'])
    })

    it('stops at last value when loop is off', async () => {
      const wrapper = mountControls({ currentValue: '100' })
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')

      // Disable loop
      const loopCheckbox = wrapper.findComponent(NCheckbox)
      loopCheckbox.vm.$emit('update:checked', false)
      await nextTick()

      // Stop and restart at last value
      await playBtn.trigger('click') // pause
      await wrapper.setProps({ currentValue: '2000' })
      await playBtn.trigger('click') // play

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()

      expect(playBtn.attributes('aria-label')).toBe('Play playback')
    })

    it('does not start playback with 0 or 1 values', async () => {
      const wrapper = mountControls({ values: ['only'], currentValue: 'only' })
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')
      expect(playBtn.attributes('aria-label')).toBe('Play playback')
    })

    it('shows loop controls when playing, hides when stopped', async () => {
      const wrapper = mountControls()
      expect(wrapper.findComponent(NCheckbox).exists()).toBe(false)

      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')
      expect(wrapper.findComponent(NCheckbox).exists()).toBe(true)

      await playBtn.trigger('click') // pause
      expect(wrapper.findComponent(NCheckbox).exists()).toBe(false)
    })

    it('has 6 speed options', async () => {
      const wrapper = mountControls()
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')

      const speedSelect = wrapper.findAllComponents(NSelect).find(
        (s) => s.attributes('aria-label') === 'Playback speed'
      )!
      const options = speedSelect.props('options') as Array<{ label: string; value: number }>
      expect(options).toHaveLength(6)
      expect(options.map((o) => o.label)).toEqual(['0.25s', '0.33s', '0.5s', '1s', '2s', '3s'])
    })

    it('adjusts playback interval when speed changes', async () => {
      const wrapper = mountControls({ currentValue: '100' })
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')

      const speedSelect = wrapper.findAllComponents(NSelect).find(
        (s) => s.attributes('aria-label') === 'Playback speed'
      )!
      speedSelect.vm.$emit('update:value', 500)
      await nextTick()

      vi.advanceTimersByTime(500)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('change')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['500'])
    })

    it('stops playback when values prop changes', async () => {
      const wrapper = mountControls({ currentValue: '100' })
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')
      expect(playBtn.attributes('aria-label')).toBe('Pause playback')

      await wrapper.setProps({ values: ['a', 'b', 'c'] })
      expect(playBtn.attributes('aria-label')).toBe('Play playback')
    })

    it('play button shows play icon (svg with play-icon class) when not playing', () => {
      const wrapper = mountControls()
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      expect(playBtn.find('svg.play-icon').exists()).toBe(true)
    })

    it('play button shows pause icon when playing', async () => {
      const wrapper = mountControls()
      const playBtn = wrapper.find('[data-testid="play-pause-button"]')
      await playBtn.trigger('click')
      expect(playBtn.find('svg.play-icon').exists()).toBe(false)
      expect(playBtn.find('svg').exists()).toBe(true)
    })

    it('play button has circle shape', () => {
      const wrapper = mountControls()
      const buttons = wrapper.findAllComponents(NButton)
      const playBtnComponent = buttons.find(
        (b) => b.attributes('data-testid') === 'play-pause-button'
      )
      expect(playBtnComponent).toBeDefined()
      expect(playBtnComponent!.props('circle')).toBe(true)
    })
  })
})
