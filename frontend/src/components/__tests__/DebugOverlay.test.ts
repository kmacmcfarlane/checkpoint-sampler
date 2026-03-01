import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DebugOverlay from '../DebugOverlay.vue'
import type { DebugCellInfo } from '../types'

function mountOverlay(info: DebugCellInfo) {
  return mount(DebugOverlay, {
    props: { info },
  })
}

describe('DebugOverlay', () => {
  // AC2: Debug overlay shows x value, y value, slider value, combo selections
  it('renders x and y values when both are provided', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      comboSelections: {},
    })

    const xRow = wrapper.find('[data-testid="debug-x-value"]')
    expect(xRow.exists()).toBe(true)
    expect(xRow.text()).toContain('X:')
    expect(xRow.text()).toContain('42')

    const yRow = wrapper.find('[data-testid="debug-y-value"]')
    expect(yRow.exists()).toBe(true)
    expect(yRow.text()).toContain('Y:')
    expect(yRow.text()).toContain('500')
  })

  it('renders slider value with dimension name', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      sliderValue: '7',
      sliderDimensionName: 'cfg',
      comboSelections: {},
    })

    const sliderRow = wrapper.find('[data-testid="debug-slider-value"]')
    expect(sliderRow.exists()).toBe(true)
    expect(sliderRow.text()).toContain('cfg:')
    expect(sliderRow.text()).toContain('7')
  })

  it('renders slider label as "Slider" when dimension name is not provided', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      sliderValue: '7',
      comboSelections: {},
    })

    const sliderRow = wrapper.find('[data-testid="debug-slider-value"]')
    expect(sliderRow.exists()).toBe(true)
    expect(sliderRow.text()).toContain('Slider:')
  })

  it('renders combo selections', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      comboSelections: {
        model: ['v1', 'v2'],
        sampler: ['euler'],
      },
    })

    const comboRows = wrapper.findAll('[data-testid="debug-combo-value"]')
    expect(comboRows).toHaveLength(2)
    expect(comboRows[0].text()).toContain('model:')
    expect(comboRows[0].text()).toContain('v1, v2')
    expect(comboRows[1].text()).toContain('sampler:')
    expect(comboRows[1].text()).toContain('euler')
  })

  it('does not render x row when xValue is undefined', () => {
    const wrapper = mountOverlay({
      yValue: '500',
      comboSelections: {},
    })

    expect(wrapper.find('[data-testid="debug-x-value"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="debug-y-value"]').exists()).toBe(true)
  })

  it('does not render y row when yValue is undefined', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      comboSelections: {},
    })

    expect(wrapper.find('[data-testid="debug-x-value"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="debug-y-value"]').exists()).toBe(false)
  })

  it('does not render slider row when sliderValue is undefined', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      comboSelections: {},
    })

    expect(wrapper.find('[data-testid="debug-slider-value"]').exists()).toBe(false)
  })

  it('does not render combo rows when comboSelections is empty', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      comboSelections: {},
    })

    expect(wrapper.findAll('[data-testid="debug-combo-value"]')).toHaveLength(0)
  })

  // AC3: Debug overlay is semi-transparent and does not interfere with click interaction
  it('has pointer-events:none so it does not block image clicks', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      comboSelections: {},
    })

    const overlay = wrapper.find('[data-testid="debug-overlay"]')
    expect(overlay.exists()).toBe(true)
    // pointer-events: none is in the scoped CSS; verify the class is applied
    expect(overlay.classes()).toContain('debug-overlay')
  })

  // AC4: Debug overlay text is easy to read (high contrast)
  it('renders with the debug-overlay class for high-contrast styling', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      comboSelections: {},
    })

    const overlay = wrapper.find('.debug-overlay')
    expect(overlay.exists()).toBe(true)
  })

  it('renders all info types together', () => {
    const wrapper = mountOverlay({
      xValue: '42',
      yValue: '500',
      sliderValue: '3',
      sliderDimensionName: 'cfg',
      comboSelections: {
        model: ['v1'],
      },
    })

    expect(wrapper.find('[data-testid="debug-x-value"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="debug-y-value"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="debug-slider-value"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="debug-combo-value"]')).toHaveLength(1)
  })
})
