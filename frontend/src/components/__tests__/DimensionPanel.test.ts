import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect } from 'naive-ui'
import DimensionPanel from '../DimensionPanel.vue'
import type { DimensionRole, FilterMode, ScanDimension } from '../../api/types'

const sampleDimensions: ScanDimension[] = [
  { name: 'step', type: 'int', values: ['500', '1000', '1500'] },
  { name: 'seed', type: 'int', values: ['42', '123'] },
  { name: 'prompt_name', type: 'string', values: ['landscape', 'portrait'] },
]

/** A mixed set where 'cfg' has only one value — it should be sorted to the bottom. */
const dimensionsWithSingleValue: ScanDimension[] = [
  { name: 'step', type: 'int', values: ['500', '1000', '1500'] },
  { name: 'cfg', type: 'int', values: ['7'] },
  { name: 'seed', type: 'int', values: ['42', '123'] },
]

function makeAssignmentsFor(
  dims: ScanDimension[],
  overrides: Record<string, DimensionRole> = {}
): Map<string, DimensionRole> {
  const map = new Map<string, DimensionRole>()
  for (const dim of dims) {
    map.set(dim.name, overrides[dim.name] ?? 'none')
  }
  return map
}

function makeFilterModesFor(
  dims: ScanDimension[],
  overrides: Record<string, FilterMode> = {}
): Map<string, FilterMode> {
  const map = new Map<string, FilterMode>()
  for (const dim of dims) {
    map.set(dim.name, overrides[dim.name] ?? 'hide')
  }
  return map
}

function makeAssignments(
  overrides: Record<string, DimensionRole> = {}
): Map<string, DimensionRole> {
  return makeAssignmentsFor(sampleDimensions, overrides)
}

function makeFilterModes(
  overrides: Record<string, FilterMode> = {}
): Map<string, FilterMode> {
  return makeFilterModesFor(sampleDimensions, overrides)
}

describe('DimensionPanel', () => {
  it('renders a row for each dimension', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const rows = wrapper.findAll('.dimension-row')
    expect(rows).toHaveLength(3)
  })

  it('displays dimension names', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const names = wrapper.findAll('.dimension-name')
    expect(names[0].text()).toBe('step')
    expect(names[1].text()).toBe('seed')
    expect(names[2].text()).toBe('prompt_name')
  })

  it('displays value count for each dimension', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const valueCounts = wrapper.findAll('.dimension-values')
    expect(valueCounts[0].text()).toBe('3 values')
    expect(valueCounts[1].text()).toBe('2 values')
    expect(valueCounts[2].text()).toBe('2 values')
  })

  it('renders two NSelects per dimension (role + filter mode)', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // 3 dimensions × 2 selects each = 6
    expect(selects).toHaveLength(6)
  })

  it('role select has four role options', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // First NSelect in row is role
    const options = selects[0].props('options') as Array<{ value: string; label: string }>
    expect(options).toHaveLength(4)
    expect(options.map((o) => o.label)).toEqual(['X Axis', 'Y Axis', 'Slider', 'None'])
  })

  it('filter mode select has three options', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // Second NSelect in row is filter mode
    const options = selects[1].props('options') as Array<{ value: string; label: string }>
    expect(options).toHaveLength(3)
    expect(options.map((o) => o.label)).toEqual(['Hide', 'Single', 'Multi'])
  })

  it('shows current role assignment as selected value', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x', seed: 'y' }),
        filterModes: makeFilterModes(),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].props('value')).toBe('x')
    expect(selects[2].props('value')).toBe('y')
    expect(selects[4].props('value')).toBe('none')
  })

  it('shows current filter mode as selected value', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments(),
        filterModes: makeFilterModes({ step: 'multi', seed: 'single' }),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // Filter mode selects are at indices 1, 3, 5
    expect(selects[1].props('value')).toBe('multi')
    expect(selects[3].props('value')).toBe('single')
    expect(selects[5].props('value')).toBe('hide')
  })

  it('shows multi for dimensions assigned to x/y/slider', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x' }),
        filterModes: makeFilterModes({ step: 'hide' }), // should be overridden
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // step filter mode select should show 'multi' regardless of filterModes map
    expect(selects[1].props('value')).toBe('multi')
  })

  it('disables filter mode select for x/y/slider dimensions', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x', seed: 'slider' }),
        filterModes: makeFilterModes(),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // Filter mode selects: indices 1, 3, 5
    expect(selects[1].props('disabled')).toBe(true) // step=x
    expect(selects[3].props('disabled')).toBe(true) // seed=slider
    expect(selects[5].props('disabled')).toBe(false) // prompt_name=none
  })

  it('emits assign event when role is changed', async () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    selects[0].vm.$emit('update:value', 'x')
    await nextTick()

    const emitted = wrapper.emitted('assign')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['step', 'x'])
  })

  it('emits update:filterMode event when filter mode is changed', async () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // Filter mode select for first dimension is at index 1
    selects[1].vm.$emit('update:value', 'multi')
    await nextTick()

    const emitted = wrapper.emitted('update:filterMode')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['step', 'multi'])
  })

  it('does not render when dimensions are empty', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: [], assignments: new Map(), filterModes: new Map() },
    })

    expect(wrapper.find('.dimension-panel').exists()).toBe(false)
  })

  it('has accessible labels on role selects', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].attributes('aria-label')).toBe('Role for step')
    expect(selects[2].attributes('aria-label')).toBe('Role for seed')
  })

  it('has accessible labels on filter mode selects', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[1].attributes('aria-label')).toBe('Filter mode for step')
    expect(selects[3].attributes('aria-label')).toBe('Filter mode for seed')
  })

  describe('single-value dimension behavior', () => {
    it('sorts single-value dimensions to the bottom of the list', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dimensionsWithSingleValue,
          assignments: makeAssignmentsFor(dimensionsWithSingleValue),
          filterModes: makeFilterModesFor(dimensionsWithSingleValue),
        },
      })

      // Input order: step (multi), cfg (single), seed (multi)
      // Expected sorted order: step, seed (multi-value first), then cfg (single-value last)
      const names = wrapper.findAll('.dimension-name')
      expect(names[0].text()).toBe('step')
      expect(names[1].text()).toBe('seed')
      expect(names[2].text()).toBe('cfg')
    })

    it('applies dimension-row--disabled class to single-value dimensions', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dimensionsWithSingleValue,
          assignments: makeAssignmentsFor(dimensionsWithSingleValue),
          filterModes: makeFilterModesFor(dimensionsWithSingleValue),
        },
      })

      const rows = wrapper.findAll('.dimension-row')
      // After sorting: step (index 0), seed (index 1) are multi-value; cfg (index 2) is single-value
      expect(rows[0].classes()).not.toContain('dimension-row--disabled')
      expect(rows[1].classes()).not.toContain('dimension-row--disabled')
      expect(rows[2].classes()).toContain('dimension-row--disabled')
    })

    it('disables the role select for single-value dimensions', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dimensionsWithSingleValue,
          assignments: makeAssignmentsFor(dimensionsWithSingleValue),
          filterModes: makeFilterModesFor(dimensionsWithSingleValue),
        },
      })

      const selects = wrapper.findAllComponents(NSelect)
      // After sorting: step (role=0, filter=1), seed (role=2, filter=3), cfg (role=4, filter=5)
      expect(selects[0].props('disabled')).toBe(false) // step role — multi-value, enabled
      expect(selects[2].props('disabled')).toBe(false) // seed role — multi-value, enabled
      expect(selects[4].props('disabled')).toBe(true)  // cfg role — single-value, disabled
    })

    it('does not disable the filter mode select for single-value dimensions', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dimensionsWithSingleValue,
          assignments: makeAssignmentsFor(dimensionsWithSingleValue),
          filterModes: makeFilterModesFor(dimensionsWithSingleValue),
        },
      })

      const selects = wrapper.findAllComponents(NSelect)
      // After sorting: cfg is at index 2, its filter mode select is at index 5
      // cfg has a single value but its role is 'none' so filter mode should NOT be disabled
      expect(selects[5].props('disabled')).toBe(false)
    })

    it('preserves multi-value dimension order relative to each other', () => {
      const dims: ScanDimension[] = [
        { name: 'prompt', type: 'string', values: ['a', 'b'] },
        { name: 'fixed_lora', type: 'string', values: ['v1'] },
        { name: 'step', type: 'int', values: ['500', '1000'] },
        { name: 'fixed_cfg', type: 'int', values: ['7'] },
        { name: 'seed', type: 'int', values: ['42', '99'] },
      ]
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dims,
          assignments: makeAssignmentsFor(dims),
          filterModes: makeFilterModesFor(dims),
        },
      })

      const names = wrapper.findAll('.dimension-name')
      // Multi-value first (original relative order): prompt, step, seed
      // Single-value last (original relative order): fixed_lora, fixed_cfg
      expect(names[0].text()).toBe('prompt')
      expect(names[1].text()).toBe('step')
      expect(names[2].text()).toBe('seed')
      expect(names[3].text()).toBe('fixed_lora')
      expect(names[4].text()).toBe('fixed_cfg')
    })

    it('sorts dynamically when dimensions prop changes', async () => {
      const initialDims: ScanDimension[] = [
        { name: 'step', type: 'int', values: ['500', '1000'] },
        { name: 'cfg', type: 'int', values: ['7'] },
      ]
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: initialDims,
          assignments: makeAssignmentsFor(initialDims),
          filterModes: makeFilterModesFor(initialDims),
        },
      })

      // Initially cfg is single-value (1 value) → sorted to bottom
      let names = wrapper.findAll('.dimension-name')
      expect(names[0].text()).toBe('step')
      expect(names[1].text()).toBe('cfg')

      // Update: cfg gains a second value → now multi-value → reverts to original order
      const updatedDims: ScanDimension[] = [
        { name: 'step', type: 'int', values: ['500', '1000'] },
        { name: 'cfg', type: 'int', values: ['7', '3.5'] },
      ]
      await wrapper.setProps({
        dimensions: updatedDims,
        assignments: makeAssignmentsFor(updatedDims),
        filterModes: makeFilterModesFor(updatedDims),
      })
      await nextTick()

      names = wrapper.findAll('.dimension-name')
      // Both are multi-value now; original order is step, cfg
      expect(names[0].text()).toBe('step')
      expect(names[1].text()).toBe('cfg')
      expect(wrapper.findAll('.dimension-row--disabled')).toHaveLength(0)
    })
  })
})
