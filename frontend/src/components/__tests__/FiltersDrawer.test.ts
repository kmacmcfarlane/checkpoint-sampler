import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NDrawer } from 'naive-ui'
import FiltersDrawer from '../FiltersDrawer.vue'
import DimensionFilter from '../DimensionFilter.vue'
import type { FilterMode } from '../../api/types'

const sampleDimensions = [
  { name: 'seed', values: ['42', '43', '44'] },
  { name: 'cfg', values: ['1', '3', '7'] },
  { name: 'prompt_name', values: ['forest', 'city'] },
]

function makeComboSelections(): Record<string, Set<string>> {
  return {
    seed: new Set(['42', '43', '44']),
    cfg: new Set(['1', '3', '7']),
    prompt_name: new Set(['forest', 'city']),
  }
}

function mountFiltersDrawer(overrides: {
  show?: boolean
  dimensions?: Array<{ name: string; values: string[] }>
  filterModes?: Record<string, FilterMode>
} = {}) {
  const filterModes = overrides.filterModes ?? {}
  return mount(FiltersDrawer, {
    props: {
      show: overrides.show ?? true,
      dimensions: overrides.dimensions ?? sampleDimensions,
      comboSelections: makeComboSelections(),
      getFilterMode: (name: string): FilterMode => filterModes[name] ?? 'multi',
    },
    global: {
      stubs: { Teleport: true },
    },
  })
}

describe('FiltersDrawer', () => {
  describe('visibility', () => {
    it('AC1: passes show prop to NDrawer', () => {
      const wrapper = mountFiltersDrawer({ show: true })
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.exists()).toBe(true)
      expect(drawer.props('show')).toBe(true)
    })

    it('AC1: passes show=false to NDrawer when closed', () => {
      const wrapper = mountFiltersDrawer({ show: false })
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('show')).toBe(false)
    })

    it('emits update:show when NDrawer update:show fires', async () => {
      const wrapper = mountFiltersDrawer({ show: true })
      const drawer = wrapper.findComponent(NDrawer)
      drawer.vm.$emit('update:show', false)
      await nextTick()

      const emitted = wrapper.emitted('update:show')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual([false])
    })

    it('NDrawer uses right placement', () => {
      const wrapper = mountFiltersDrawer()
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('placement')).toBe('right')
    })

    it('NDrawer has width 320', () => {
      const wrapper = mountFiltersDrawer()
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe(320)
    })
  })

  describe('AC1: DimensionFilter rendering — no individual collapse', () => {
    it('renders a DimensionFilter for each non-hidden dimension', () => {
      const wrapper = mountFiltersDrawer({
        dimensions: sampleDimensions,
        filterModes: { seed: 'multi', cfg: 'single', prompt_name: 'multi' },
      })
      const filters = wrapper.findAllComponents(DimensionFilter)
      // All 3 dimensions are non-hide, so 3 DimensionFilters should render
      expect(filters).toHaveLength(3)
    })

    it('passes alwaysExpanded=true to each DimensionFilter', () => {
      // AC1: No individual collapse — filters show content immediately
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      for (const filter of filters) {
        expect(filter.props('alwaysExpanded')).toBe(true)
      }
    })

    it('does not show visible content for hide-mode dimensions', () => {
      // DimensionFilter renders nothing (v-if on root div) when filterMode === 'hide'
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'hide', cfg: 'multi', prompt_name: 'multi' },
      })
      // 'seed' is hide mode — its root .dimension-filter div is not rendered
      // cfg and prompt_name are multi mode — their root divs are rendered
      const visibleFilters = wrapper.findAll('.dimension-filter')
      expect(visibleFilters).toHaveLength(2)
    })

    it('passes correct dimension name to each DimensionFilter', () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const names = filters.map((f) => f.props('dimensionName'))
      expect(names).toContain('seed')
      expect(names).toContain('cfg')
      expect(names).toContain('prompt_name')
    })

    it('passes correct values to each DimensionFilter', () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const seedFilter = filters.find((f) => f.props('dimensionName') === 'seed')
      expect(seedFilter).toBeDefined()
      expect(seedFilter!.props('values')).toEqual(['42', '43', '44'])
    })

    it('passes selected set from comboSelections to DimensionFilter', () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const cfgFilter = filters.find((f) => f.props('dimensionName') === 'cfg')
      expect(cfgFilter).toBeDefined()
      const selected = cfgFilter!.props('selected') as Set<string>
      expect(selected.has('1')).toBe(true)
      expect(selected.has('3')).toBe(true)
      expect(selected.has('7')).toBe(true)
    })

    it('passes filterMode from getFilterMode to DimensionFilter', () => {
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'single', cfg: 'multi', prompt_name: 'multi' },
      })
      const filters = wrapper.findAllComponents(DimensionFilter)
      const seedFilter = filters.find((f) => f.props('dimensionName') === 'seed')
      expect(seedFilter!.props('filterMode')).toBe('single')
    })
  })

  describe('AC4: filter-update event forwarding', () => {
    it('emits filter-update when DimensionFilter emits update', async () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const firstFilter = filters[0]

      // Simulate DimensionFilter emitting an update
      firstFilter.vm.$emit('update', 'seed', new Set(['42']))
      await nextTick()

      const emitted = wrapper.emitted('filter-update')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      const [dimName, selected] = emitted![0] as [string, Set<string>]
      expect(dimName).toBe('seed')
      expect(selected.has('42')).toBe(true)
    })
  })

  describe('empty state', () => {
    it('shows empty message when all dimensions are in hide mode', () => {
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'hide', cfg: 'hide', prompt_name: 'hide' },
      })
      const emptyMsg = wrapper.find('.filters-drawer__empty')
      expect(emptyMsg.exists()).toBe(true)
    })

    it('does not show empty message when at least one non-hide dimension exists', () => {
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'multi', cfg: 'hide', prompt_name: 'hide' },
      })
      const emptyMsg = wrapper.find('.filters-drawer__empty')
      expect(emptyMsg.exists()).toBe(false)
    })
  })
})
