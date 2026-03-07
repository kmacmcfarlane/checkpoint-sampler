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

/** A mixed set where 'cfg' has only one value -- it should be sorted to the bottom. */
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
    // AC3: Default to 'single' for multi-value, AC4: 'hide' for single-value
    const defaultMode: FilterMode = dim.values.length <= 1 ? 'hide' : 'single'
    map.set(dim.name, overrides[dim.name] ?? defaultMode)
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
  // AC1: Each dimension row has a single dropdown
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

  // AC1: Each dimension row has a SINGLE dropdown (unified selector)
  it('renders one NSelect per dimension (unified selector)', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // 3 dimensions x 1 select each = 3
    expect(selects).toHaveLength(3)
  })

  // AC1: Unified dropdown has options: X, Y, Slider, Single, Multi, Hide
  it('unified selector has six options when no axes are assigned', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    const options = selects[0].props('options') as Array<{ value: string; label: string }>
    expect(options).toHaveLength(6)
    expect(options.map((o) => o.label)).toEqual([
      'X Axis', 'Y Axis', 'Slider', 'Single', 'Multi', 'Hide',
    ])
  })

  // AC3: Dimensions not assigned to X/Y/Slider default to Single
  it('shows Single as default for unassigned multi-value dimensions', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments(),
        filterModes: makeFilterModes(),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // All three dimensions are unassigned, should show 'single'
    expect(selects[0].props('value')).toBe('single')
    expect(selects[1].props('value')).toBe('single')
    expect(selects[2].props('value')).toBe('single')
  })

  it('shows axis role for assigned dimensions', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x', seed: 'y' }),
        filterModes: makeFilterModes({ step: 'multi', seed: 'multi' }),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].props('value')).toBe('x')
    expect(selects[1].props('value')).toBe('y')
    expect(selects[2].props('value')).toBe('single')
  })

  it('shows filter mode for unassigned dimensions with custom filter modes', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments(),
        filterModes: makeFilterModes({ step: 'multi', seed: 'hide' }),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].props('value')).toBe('multi')
    expect(selects[1].props('value')).toBe('hide')
    expect(selects[2].props('value')).toBe('single')
  })

  // AC2: All axis options are always shown — parent handles swapping on conflict
  it('shows all axis options for all dimensions regardless of current assignments', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x', seed: 'slider' }),
        filterModes: makeFilterModes({ step: 'multi', seed: 'multi' }),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)

    // step has X, so its dropdown should include X (its own)
    const stepOptions = (selects[0].props('options') as Array<{ value: string }>).map((o) => o.value)
    expect(stepOptions).toContain('x')
    // All axis options should be available for prompt_name too (swap behavior)
    const promptOptions = (selects[2].props('options') as Array<{ value: string }>).map((o) => o.value)
    expect(promptOptions).toContain('x')
    expect(promptOptions).toContain('slider')
    expect(promptOptions).toContain('y')
    expect(promptOptions).toContain('single')
    expect(promptOptions).toContain('multi')
    expect(promptOptions).toContain('hide')
  })

  // AC2: Dimension that holds an axis sees its own axis option
  it('shows the held axis option for the dimension that has it', () => {
    const wrapper = mount(DimensionPanel, {
      props: {
        dimensions: sampleDimensions,
        assignments: makeAssignments({ step: 'x' }),
        filterModes: makeFilterModes({ step: 'multi' }),
      },
    })

    const selects = wrapper.findAllComponents(NSelect)
    // step holds X, so X should be available in step's options
    const stepOptions = (selects[0].props('options') as Array<{ value: string }>).map((o) => o.value)
    expect(stepOptions).toContain('x')
    expect(stepOptions).toContain('y')
    expect(stepOptions).toContain('slider')
  })

  it('emits update:mode event when unified mode is changed', async () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    selects[0].vm.$emit('update:value', 'x')
    await nextTick()

    const emitted = wrapper.emitted('update:mode')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['step', 'x'])
  })

  it('emits update:mode for filter mode selections', async () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    selects[1].vm.$emit('update:value', 'multi')
    await nextTick()

    const emitted = wrapper.emitted('update:mode')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['seed', 'multi'])
  })

  it('does not emit when value is null', async () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    selects[0].vm.$emit('update:value', null)
    await nextTick()

    expect(wrapper.emitted('update:mode')).toBeUndefined()
  })

  it('does not render when dimensions are empty', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: [], assignments: new Map(), filterModes: new Map() },
    })

    expect(wrapper.find('.dimension-panel').exists()).toBe(false)
  })

  it('has accessible labels on unified selects', () => {
    const wrapper = mount(DimensionPanel, {
      props: { dimensions: sampleDimensions, assignments: makeAssignments(), filterModes: makeFilterModes() },
    })

    const selects = wrapper.findAllComponents(NSelect)
    expect(selects[0].attributes('aria-label')).toBe('Mode for step')
    expect(selects[1].attributes('aria-label')).toBe('Mode for seed')
    expect(selects[2].attributes('aria-label')).toBe('Mode for prompt_name')
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

    // AC4: Dimensions with only one value default to Hide and the selector is disabled
    it('disables the unified select for single-value dimensions', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dimensionsWithSingleValue,
          assignments: makeAssignmentsFor(dimensionsWithSingleValue),
          filterModes: makeFilterModesFor(dimensionsWithSingleValue),
        },
      })

      const selects = wrapper.findAllComponents(NSelect)
      // After sorting: step (0), seed (1), cfg (2)
      expect(selects[0].props('disabled')).toBe(false) // step -- multi-value, enabled
      expect(selects[1].props('disabled')).toBe(false) // seed -- multi-value, enabled
      expect(selects[2].props('disabled')).toBe(true)  // cfg -- single-value, disabled
    })

    // AC4: Single-value dimensions default to Hide
    it('shows Hide for single-value dimensions regardless of stored filter mode', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dimensionsWithSingleValue,
          assignments: makeAssignmentsFor(dimensionsWithSingleValue),
          // Even if filterModes stores 'single' for cfg, it should display as 'hide'
          filterModes: makeFilterModesFor(dimensionsWithSingleValue, { cfg: 'single' }),
        },
      })

      const selects = wrapper.findAllComponents(NSelect)
      // cfg is at index 2 after sorting
      expect(selects[2].props('value')).toBe('hide')
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

      // Initially cfg is single-value (1 value) -> sorted to bottom
      let names = wrapper.findAll('.dimension-name')
      expect(names[0].text()).toBe('step')
      expect(names[1].text()).toBe('cfg')

      // Update: cfg gains a second value -> now multi-value -> reverts to original order
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

  describe('axis options always available', () => {
    // AC2: All axis options are shown even when taken by other dimensions (swap behavior)
    it('shows all axis options even when all three axes are taken by other dims', () => {
      const dims: ScanDimension[] = [
        { name: 'step', type: 'int', values: ['500', '1000'] },
        { name: 'seed', type: 'int', values: ['42', '123'] },
        { name: 'cfg', type: 'int', values: ['1', '7'] },
        { name: 'prompt', type: 'string', values: ['a', 'b'] },
      ]
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: dims,
          assignments: makeAssignmentsFor(dims, { step: 'x', seed: 'y', cfg: 'slider' }),
          filterModes: makeFilterModesFor(dims, { step: 'multi', seed: 'multi', cfg: 'multi' }),
        },
      })

      const selects = wrapper.findAllComponents(NSelect)
      // prompt should still see all options including axis roles (parent handles swapping)
      const promptOptions = (selects[3].props('options') as Array<{ value: string }>).map((o) => o.value)
      expect(promptOptions).toEqual(['x', 'y', 'slider', 'single', 'multi', 'hide'])
    })

    it('shows all axis options for every dimension regardless of current assignments', () => {
      const wrapper = mount(DimensionPanel, {
        props: {
          dimensions: sampleDimensions,
          assignments: makeAssignments({ step: 'x' }),
          filterModes: makeFilterModes({ step: 'multi' }),
        },
      })

      const selects = wrapper.findAllComponents(NSelect)
      // seed should also see 'x' even though step holds it (parent handles swap)
      const seedOptions = (selects[1].props('options') as Array<{ value: string }>).map((o) => o.value)
      expect(seedOptions).toContain('x')
      expect(seedOptions).toContain('y')
      expect(seedOptions).toContain('slider')
    })
  })
})
