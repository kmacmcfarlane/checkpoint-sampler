import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NSelect } from 'naive-ui'
import DimensionPanel from '../DimensionPanel.vue'
import type { DimensionRole, ScanDimension } from '../../api/types'

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

describe('DimensionPanel', () => {
  it('renders a row for each dimension', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments() },
    })

    const rows = wrapper.findAll('.dimension-row')
    expect(rows).toHaveLength(3)
  })

  it('displays dimension names', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments() },
    })

    const names = wrapper.findAll('.dimension-name')
    expect(names[0].text()).toBe('step')
    expect(names[1].text()).toBe('seed')
    expect(names[2].text()).toBe('prompt_name')
  })

  it('displays value count for each dimension', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments() },
    })

    const valueCounts = wrapper.findAll('.dimension-values')
    expect(valueCounts[0].text()).toBe('3 values')
    expect(valueCounts[1].text()).toBe('2 values')
    expect(valueCounts[2].text()).toBe('2 values')
  })

  it('renders NSelect with four role options per dimension', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects).toHaveLength(3)

    const options = selects[0].props('options') as Array<{ value: string; label: string }>
    expect(options).toHaveLength(4)
    expect(options.map((o) => o.label)).toEqual(['X Axis', 'Y Axis', 'Slider', 'None'])
  })

  it('shows current role assignment as selected value', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x', seed: 'y' }),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].props('value')).toBe('x')
    expect(selects[1].props('value')).toBe('y')
    expect(selects[2].props('value')).toBe('none')
  })

  it('emits assign event when role is changed', async () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    selects[0].vm.$emit('update:value', 'x')
    await nextTick()

    const emitted = wrapper.emitted('assign')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['step', 'x'])
  })

  it('does not render when dimensions are empty', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: [], assignments: new Map() },
    })

    expect(wrapper.find('.dimension-panel').exists()).toBe(false)
  })

  it('has accessible labels on role selects', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].attributes('aria-label')).toBe('Role for step')
    expect(selects[1].attributes('aria-label')).toBe('Role for seed')
  })
})
