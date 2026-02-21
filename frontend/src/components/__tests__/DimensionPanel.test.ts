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

function makeAssignments(
  overrides: Record<string, DimensionRole> = {}
): Map<string, DimensionRole> {
  const map = new Map<string, DimensionRole>()
  for (const dim of sampleDimensions) {
    map.set(dim.name, overrides[dim.name] ?? 'none')
  }
  return map
}

function makeFilterModes(
  overrides: Record<string, FilterMode> = {}
): Map<string, FilterMode> {
  const map = new Map<string, FilterMode>()
  for (const dim of sampleDimensions) {
    map.set(dim.name, overrides[dim.name] ?? 'hide')
  }
  return map
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
})
